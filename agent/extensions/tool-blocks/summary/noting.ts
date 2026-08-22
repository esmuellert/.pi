/**
 * The hook that puts the sentence under a bash block.
 *
 * Separate from summary.ts so that the part which talks to a model can be
 * tested without a theme or a render context.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

import type { RenderArgs, RenderContext } from "../tools/builtins.ts";
import { type Slot, summaryFor } from "./summary.ts";

export { useRegistry } from "./summary.ts";

/** Indent, so the sentence reads as a note on the block rather than output. */
export const INDENT = "  ";

/**
 * The colour the sentence is painted in.
 *
 * Not a grey. `muted` resolves to the same colour as `toolOutput`, so the
 * sentence read as more of the command's output rather than as a note about
 * it. A hue separates it from both the command above and the output between.
 */
export const COLOUR = "success";

/**
 * Wrap a sentence to the column it will be drawn in, indenting every line.
 *
 * `wrapTextWithAnsi` is what pi's own Text wraps with, so a note breaks where
 * pi would break it. Wrapping before the indent is added and then indenting
 * each line keeps the continuation under the first word rather than under the
 * block's own output.
 */
export function layout(text: string, width: number, theme: Theme): string[] {
	const room = width - INDENT.length;
	if (room < 1) return [];
	return wrapTextWithAnsi(text, room).map((line) => theme.fg(COLOUR, INDENT + line));
}

export function noting() {
	return (
		width: number,
		args: RenderArgs,
		theme: Theme,
		context: RenderContext,
	): string[] | undefined => {
		const command = (args as { command?: unknown }).command;
		if (typeof command !== "string") return undefined;
		const text = summaryFor(
			command,
			context.argsComplete === true,
			context.state as Slot,
			context.invalidate,
		);
		return text ? layout(text, width, theme) : undefined;
	};
}
