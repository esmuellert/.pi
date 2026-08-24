/**
 * Asking a model for a session's name.
 *
 * pi already has `/name <name>`, which is handled before extension commands
 * reach the dispatcher, so this command is `/rename`. What pi has no version of
 * is the empty call: 71 sessions on this machine, none of them named, because
 * naming a session is a thing you have to stop and do.
 */

import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

/** A message as it appears in the context pi sends to the model. */
export interface ContextMessage {
	role?: string;
	content?: unknown;
}

/** Just enough of pi's session manager to read a conversation back. */
export interface Branch {
	buildContextEntries: () => readonly { type?: string; message?: ContextMessage }[];
}

/**
 * The conversation as stored, for when no request has been built yet.
 *
 * `buildContextEntries` is what pi itself calls to rebuild a context, so this
 * path and the `context` event see the same turns. `getBranch` would return the
 * whole file instead -- 3478 messages against 1255 on one real session here,
 * most of them already replaced by a compaction summary, which would name the
 * session after work that is days behind it.
 *
 * Compaction entries are skipped rather than unpacked, for the same reason.
 */
export function fromBranch(branch: Branch | undefined): readonly ContextMessage[] {
	const out: ContextMessage[] = [];
	for (const entry of branch?.buildContextEntries?.() ?? []) {
		if (entry.type !== "message" || !entry.message) continue;
		out.push(entry.message);
	}
	return out;
}

/**
 * What the model is told.
 *
 * "In the language its user writes in" rather than a language this code picked:
 * a ratio test over CJK codepoints calls Spanish, French, German and Russian all
 * English, and the model has the whole conversation in front of it anyway.
 */
export const INSTRUCTION =
	"Name this coding session, for someone picking it out of a list weeks later. "
	+ "Six words at most, in the language its user writes in. "
	+ "Name what the session is about, not what a tool or a file is called. "
	+ "No preamble, no quotes, no trailing period.";

/**
 * Who writes the name.
 *
 * Pinned for the same reason the tool-block summaries are: a name whose voice
 * changes because an account gained a model is worse than one written by
 * something weaker. The fallback exists so that an account without this model
 * gets a name rather than an error.
 */
export const WRITER = "claude-sonnet-4.6";

/** The model to ask, preferring the pinned one and falling back on price. */
export function pick(models: readonly Model<Api>[]): Model<Api> | undefined {
	const pinned = models.find((model) => model.id === WRITER);
	if (pinned) return pinned;
	const priced = models.filter((model) => typeof model.cost?.input === "number");
	return [...priced].sort((a, b) => (a.cost?.input ?? 0) - (b.cost?.input ?? 0))[0] ?? models[0];
}

/** The text a context message carries, tool calls included as their arguments. */
export function textOf(message: ContextMessage): string {
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part: unknown) => {
			const piece = part as { type?: string; text?: string; arguments?: unknown; name?: string };
			if (piece.type === "text") return piece.text ?? "";
			if (piece.type === "toolCall") return `[${piece.name ?? "tool"}]`;
			return "";
		})
		.filter(Boolean)
		.join(" ");
}

/**
 * The conversation as the writer sees it.
 *
 * The whole live context, not a sample: after compaction that is a few hundred
 * messages, and which part of a session gives it its name is not something a
 * rule can decide in advance. Tool results are what the session did rather than
 * what it was about, and they are the bulk of it -- 90% of this session's bytes
 * -- so they arrive as the name of the tool alone.
 */
export function transcript(messages: readonly ContextMessage[]): string {
	const said: string[] = [];
	for (const message of messages) {
		const role = message.role;
		if (role !== "user" && role !== "assistant") continue;
		const text = textOf(message).trim();
		if (text) said.push(`${role === "user" ? "USER" : "ASSISTANT"}: ${text}`);
	}
	return said.join("\n\n");
}

/**
 * The request body, kept here so a test can read it without a model.
 *
 * The instruction is not in it. It goes in the system prompt, where a provider
 * treats it as standing orders rather than as the first paragraph of a request
 * whose remaining ten thousand tokens are a transcript. Measured on the
 * tool-block summaries, which had the same shape and drifted into another
 * language 16 times in 480 with the instruction here and 0 in 300 with it in the
 * system prompt -- Fisher, one-tailed, p = 0.0004. The conversation this reads
 * is longer than theirs, so the instruction was buried deeper.
 */
export function ask(conversation: string): string {
	return `THE CONVERSATION:\n${conversation}`;
}

/**
 * A name as it should be stored: one line, without the quotes a model puts
 * round a thing it was asked to name.
 *
 * Not shortened. pi truncates a name where it draws it -- in the footer and in
 * the session selector, both through `truncateToWidth` -- so a long one costs
 * an ellipsis rather than a broken line, and a cap here would only cut a name
 * pi was going to fit.
 *
 * The collapse and the trim are pi's own treatment of a name, repeated because
 * the quotes have to come off after them and because an empty result is how
 * this reports that nothing usable came back.
 */
export function tidy(text: string): string {
	const line = text.replace(/[\r\n]+/g, " ").trim();
	return line.replace(/^["'`«「【]+|["'`».」】]+$/g, "").trim();
}

/**
 * Ask for a name. Returns undefined when there is nothing to name it from,
 * no model to ask, or the model declines.
 */
export async function nameFor(
	registry: ModelRegistry | undefined,
	messages: readonly ContextMessage[],
): Promise<string | undefined> {
	const conversation = transcript(messages);
	if (!conversation) return undefined;
	const model = registry && pick(registry.getAvailable());
	if (!registry || !model) return undefined;
	const answer = await registry.complete(
		model,
		{
			systemPrompt: INSTRUCTION,
			messages: [{ role: "user", timestamp: Date.now(), content: ask(conversation) }],
		},
		{ thinkingLevel: "off" },
	);
	const text = (answer.content ?? [])
		.filter((part): part is { type: "text"; text: string } => (part as { type?: string }).type === "text")
		.map((part) => part.text)
		.join("");
	const name = tidy(text);
	return name || undefined;
}
