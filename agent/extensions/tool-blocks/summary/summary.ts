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

import { through } from "./queue.ts";
import { driftedFrom } from "./script.ts";
import { recall, remember } from "./store.ts";
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";

/** How long a sentence may take before the block gives up on it. */
export const DEADLINE_MS = 6_000;



/**
 * What the writer is told.
 *
 * Past tense, and addressed to someone skimming rather than someone about to
 * run the thing. Measured across seven tools: this scored 7.12 against 5.81 for
 * "saying what this shell command does", five standard errors apart, and won on
 * six of the seven. The old wording collapsed on `read` -- 4.2 -- because a
 * read is not a command, so the writer described the file's contents instead of
 * the act of reading it.
 */
export const INSTRUCTION =
	"One clause, under nine words, for a reader skimming a transcript, "
	+ "saying what this step accomplished. Name the file or target it acted on. "
	+ "No preamble, no trailing period, no quotes.";

/**
 * Written in whatever language the reader is using.
 *
 * The writer decides, from a sample of the reader's own words. Detecting it
 * here would mean writing a language detector, and the one worth writing --
 * counting CJK characters -- calls Spanish, French, German and Russian all
 * English. Asked instead, the writer got Chinese, Japanese, Spanish, French,
 * German, Russian and English right, including from a two-character sample.
 *
 * It costs nothing: over thirty commands the rule scored 7.10 against 6.93
 * without it, which is inside the error either way.
 */
export const LANGUAGE_RULE =
	" Write it in the same language as the note below, whatever that language is. "
	+ "Keep identifiers, paths and file names exactly as they appear.";

/**
 * What the writer is shown: the command, and what it printed.
 *
 * Both whole. Measured over forty real commands -- command with output scored
 * 6.30 against 5.78 for the command alone, twice the standard error apart. It
 * is what lets a sentence say "Playwright's DialogManager" where the command
 * only said `grep dialogDidOpen`.
 *
 * Nothing else helped. The assistant's own words just before the call scored
 * 4.58, last of seven shapes, because the sentence starts restating the
 * conversation rather than reading the command.
 */
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
let session: SessionSource | undefined;

/** Just enough of pi's session manager to read what the reader has written. */
export interface SessionSource {
	getBranch: () => readonly { type: string; message?: { role?: string; content?: unknown } }[];
}

/** Handed a registry at session start; picks who writes the sentences. */
export function useRegistry(found: ModelRegistry | undefined, from?: SessionSource): void {
	registry = found;
	writer = pick(found?.getAvailable?.() ?? []);
	session = from;
}

/**
 * How much of the reader's own writing to show, and how recent.
 *
 * Enough to tell a language by, and no more. The point is not context -- adding
 * the conversation scored worst of seven shapes -- it is a sample the writer
 * can read the language off.
 */
export const SAMPLE_MESSAGES = 2;
export const SAMPLE_CHARS = 300;

/** The last thing the reader wrote, for the writer to match the language of. */
export function sample(from: SessionSource | undefined = session): string {
	const branch = from?.getBranch?.() ?? [];
	const said: string[] = [];
	for (let at = branch.length - 1; at >= 0 && said.length < SAMPLE_MESSAGES; at -= 1) {
		const entry = branch[at];
		if (entry.type !== "message" || entry.message?.role !== "user") continue;
		const content = entry.message.content;
		const text = typeof content === "string"
			? content
			: (content as { type?: string; text?: string }[] | undefined ?? [])
				.filter((part) => part.type === "text")
				.map((part) => part.text ?? "")
				.join(" ");
		if (text.trim()) said.push(text.trim());
	}
	return said.reverse().join("\n").slice(-SAMPLE_CHARS);
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
	tool: string,
	args: unknown,
	output: string,
	slot: Slot,
	invalidate: () => void,
	id?: string,
): string | undefined {
	// What a previous run already paid for. Read before the slot, because the
	// slot is empty on every rebuild and this is not.
	const stored = recall(id);
	if (stored !== undefined) return stored;
	// A rebuild gives every block a fresh slot while the previous build's
	// requests are still in the air, so the slot alone would ask twice.
	if (id !== undefined && asking.has(id)) return undefined;

	const key = `${tool}\u0000${argsAsText(args)}`;
	if (slot.summaryFor !== key) {
		slot.summaryFor = key;
		slot.summary = undefined;
	}
	if (slot.summary?.text !== undefined) return slot.summary.text ?? undefined;
	if (slot.summary?.pending) return undefined;
	if (!registry || !writer) return undefined;

	slot.summary = { pending: true };
	if (id !== undefined) asking.add(id);
	const asked = registry;
	const by = writer;
	void through(() => write(asked, by, tool, args, output))
		.then((text) => {
			slot.summary = { text };
			if (text) remember(id, text);
		})
		.catch(() => {
			slot.summary = { text: null };
		})
		.finally(() => {
			if (id !== undefined) asking.delete(id);
			invalidate();
		});
	return undefined;
}

/** Tool calls with a request in the air, so a rebuild does not start a second. */
const asking = new Set<string>();

/** Forget what is in the air. For tests. */
export function unask(): void {
	asking.clear();
}

/** Strip the quotes and full stop a model adds however firmly it is told not to. */
export function tidy(raw: string): string {
	return raw.trim().replace(/^["'`\s]+|["'`.\s]+$/g, "");
}

export function ask(tool: string, args: unknown, output: string, reader = ""): string {
	const printed = output.trim();
	const written = reader.trim();
	return (written ? INSTRUCTION + LANGUAGE_RULE : INSTRUCTION)
		+ (written ? `\n\nTHE READER WRITES LIKE THIS:\n${written}` : "")
		+ `\n\nTOOL: ${tool}\nARGUMENTS:\n${argsAsText(args)}`
		+ (printed ? `\n\nIT RETURNED:\n${printed}` : "");
}

/**
 * A tool's arguments as text.
 *
 * bash's one argument is a command and reads better bare; everything else has
 * named fields worth keeping.
 */
export function argsAsText(args: unknown): string {
	const command = (args as { command?: unknown } | undefined)?.command;
	if (typeof command === "string") return command;
	try {
		return JSON.stringify(args, null, 1) ?? String(args);
	} catch {
		return String(args);
	}
}

/**
 * A sentence for a command, in the reader's own script.
 *
 * The writer drifts into another language now and then -- five sentences in
 * sixty on the block that raised it, Japanese and Korean under a session held in
 * English. No wording of the rule reached it: four phrasings scored 1, 2, 2 and
 * 11 out of 40, the differences inside the noise but for the one that made it
 * worse. Asked a second time, all five came back in the reader's own script, so
 * the drift is per-request rather than something about the command.
 *
 * One retry, and the second answer is kept whatever it says: a sentence in the
 * wrong language beats no sentence, and a loop here would be a loop against a
 * paid endpoint.
 */
async function write(
	reg: ModelRegistry,
	model: Model<Api>,
	tool: string,
	args: unknown,
	output: string,
): Promise<string | null> {
	const reader = sample();
	const first = await once(reg, model, tool, args, output, reader);
	if (first === null || !driftedFrom(reader, first)) return first;
	return (await once(reg, model, tool, args, output, reader)) ?? first;
}

/** One request, with its own deadline. */
async function once(
	reg: ModelRegistry,
	model: Model<Api>,
	tool: string,
	args: unknown,
	output: string,
	reader: string,
): Promise<string | null> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const answer = await Promise.race([
			reg.complete(
				model,
				{
					messages: [{
						role: "user",
						content: ask(tool, args, output, reader),
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
