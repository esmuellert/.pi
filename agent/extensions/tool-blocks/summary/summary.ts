/**
 * A sentence saying what a command does, written by a cheaper model.
 *
 * A folded block shows the first line of the command and how many are hidden.
 * For a heredoc that is `cd ~/.pi && python3 - <<'PYEOF'` and forty-seven lines
 * you cannot see, which says nothing about what it will do, and expanding costs
 * a keystroke and the whole screen.
 *
 * The line goes under the block rather than over the title: the title is the
 * command, and a note about the command should not stand where the command was.
 *
 * Rendering never waits. Each draw asks whether the sentence has arrived; the
 * first ask sends the request and returns nothing, and the answer arriving
 * redraws that one block.
 *
 * haiku rather than a flash model, measured rather than assumed:
 * claude-haiku-4.5 answered in 831ms against gemini-3.7-flash's 3008ms, and
 * more specifically -- "shows modified files with their status codes" rather
 * than "displays repository status".
 */
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";

/** How long a sentence may take before the block gives up on it. */
export const DEADLINE_MS = 6_000;



/** What the model is told. Kept here so a test can assert on it. */
export const INSTRUCTION =
	"One clause, under nine words, saying what this shell command does. "
	+ "No preamble, no trailing period, no quotes. Name what it touches.";

/** How much of a command is worth sending. */
export const MAX_COMMAND_CHARS = 4_000;

export interface Summary {
	/** Undefined while unknown, null once it has failed for good. */
	text?: string | null;
	pending?: boolean;
}

/** Where a block keeps its sentence. `state` is pi's per-row bag. */
export interface Slot {
	summary?: Summary;
	summaryFor?: string;
}

let registry: ModelRegistry | undefined;
let writer: Model<Api> | undefined;

/** Handed a registry at session start; picks who writes the sentences. */
export function useRegistry(found: ModelRegistry | undefined): void {
	registry = found;
	writer = pick(found?.getAvailable?.() ?? []);
}

/**
 * Who writes the sentences.
 *
 * Pinned rather than chosen at runtime: each model writes in a recognisably
 * different way, and a note whose voice changes when an account gains a model
 * is worse than one written by something weaker.
 *
 * Which one was measured -- twelve real commands, four instructions, eight
 * models, ranked blind. sonnet-4.6 led at 6.4, haiku-4.5 next at 5.2, and every
 * gemini, gpt-mini and mai model scored lower and answered slower.
 *
 * The price fallback is there so a machine without it gets sentences rather
 * than silence.
 */
export const WRITER = "claude-sonnet-4.6";

export function pick(available: readonly Model<Api>[]): Model<Api> | undefined {
	const preferred = available.find((model) => model.id === WRITER);
	if (preferred) return preferred;
	const priced = available.filter((model) => typeof model.cost?.output === "number");
	return [...priced].sort((a, b) => (a.cost?.output ?? 0) - (b.cost?.output ?? 0))[0];
}

/**
 * The sentence for a command, starting one if there is none yet.
 *
 * Returns immediately, always.
 *
 * Only ever called from the result renderer, which pi runs once the command has
 * finished -- so the command here is whole. `context.argsComplete` looks like
 * the right gate and is not: it is set on the tools still pending when a
 * message stops streaming, and a block that has already run is no longer among
 * them, so it reads false forever after.
 */
export function summaryFor(
	command: string,
	slot: Slot,
	invalidate: () => void,
): string | undefined {
	if (slot.summaryFor !== command) {
		slot.summaryFor = command;
		slot.summary = undefined;
	}
	if (slot.summary?.text !== undefined) return slot.summary.text ?? undefined;
	if (slot.summary?.pending) return undefined;
	if (!registry || !writer) return undefined;

	slot.summary = { pending: true };
	void write(registry, writer, command)
		.then((text) => {
			slot.summary = { text };
		})
		.catch(() => {
			slot.summary = { text: null };
		})
		.finally(invalidate);
	return undefined;
}

/** Strip the quotes and full stop a model adds however firmly it is told not to. */
export function tidy(raw: string): string {
	return raw.trim().replace(/^["'`\s]+|["'`.\s]+$/g, "");
}

async function write(
	reg: ModelRegistry,
	model: Model<Api>,
	command: string,
): Promise<string | null> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const answer = await Promise.race([
			reg.complete(
				model,
				{
					messages: [{
						role: "user",
						content: `${INSTRUCTION}\n\n${command.slice(0, MAX_COMMAND_CHARS)}`,
						timestamp: Date.now(),
					}],
				},
				{ thinkingLevel: "off", maxTokens: 40 },
			),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error("summary timed out")), DEADLINE_MS);
			}),
		]);
		return textOf(answer) || null;
	} finally {
		// Without this the process keeps a timer alive for six seconds after
		// every summary, which is what stops a --print run from exiting.
		if (timer) clearTimeout(timer);
	}
}

/** The plain text of an assistant message, with the model's decoration removed. */
export function textOf(message: AssistantMessage): string {
	const parts = message.content ?? [];
	return tidy(
		parts
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join(""),
	);
}
