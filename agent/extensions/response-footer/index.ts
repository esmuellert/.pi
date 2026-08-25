/**
 * A line under each reply: tools, time, cost, cache, tokens.
 *
 * pi renders assistant messages with an internal component an extension cannot
 * reach, so the line is a separate entry appended after the reply rather than
 * part of its block. `appendEntry` puts it in the session file, and
 * `sessionEntryToContextMessages` returns nothing for the `custom` type, so it
 * survives a restart without ever reaching the model.
 *
 * Not backfilled: replies from before this existed have no line, and the file
 * is not rewritten to give them one.
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

import { layout } from "./format.ts";
import { add, close, empty, type Stats, type Tally, worthShowing } from "./stats.ts";

/**
 * The entry's type name.
 *
 * Written and read through one constant, because the two must match and a
 * mismatch shows up as nothing at all rather than as an error. Renaming it
 * orphans every entry already written -- they stay in the file and stop being
 * drawn. Fields inside the data may be added or removed freely.
 */
export const ENTRY = "response-footer";

/** The colour of the line. Dim: it is a note about the reply, not part of it. */
export const COLOUR = "dim" as const;

export default function (pi: ExtensionAPI) {
	let tally: Tally | undefined;

	// A reply is many turns. The tally opens once, at the start of the run.
	pi.on("agent_start", () => {
		tally = empty(Date.now());
	});

	pi.on("message_end", (event) => {
		const message = event.message as { role?: string; content?: unknown[]; usage?: never };
		if (!tally || message.role !== "assistant") return;
		const calls = (message.content ?? []).filter(
			(part) => (part as { type?: string }).type === "toolCall",
		).length;
		add(tally, message.usage, calls);
	});

	pi.on("agent_end", () => {
		if (!tally) return;
		const stats = close(tally, Date.now());
		tally = undefined;
		if (worthShowing(stats)) pi.appendEntry(ENTRY, stats);
	});

	pi.registerEntryRenderer<Stats>(ENTRY, (entry, _options, theme: Theme) => {
		const stats = entry.data;
		if (!stats) return undefined;
		return {
			render(width: number): string[] {
				// Every field is read defensively: an entry written by an older
				// version of this file is missing whatever was added since, and a
				// renderer that throws is drawn as a red error box by pi.
				const line = layout(
					{
						tools: stats.tools ?? 0,
						ms: stats.ms ?? 0,
						tokensIn: stats.tokensIn ?? 0,
						tokensOut: stats.tokensOut ?? 0,
						cacheHit: stats.cacheHit ?? null,
						cost: stats.cost ?? 0,
					},
					width,
					visibleWidth,
				);
				if (!line) return [];
				try {
					return [theme.fg(COLOUR, line)];
				} catch {
					// theme.fg throws while a theme is being swapped.
					return [line];
				}
			},
			invalidate() {},
		};
	});
}
