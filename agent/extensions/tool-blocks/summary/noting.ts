/**
 * The hook that puts the sentence under a bash block.
 *
 * Separate from summary.ts so that the part which talks to a model can be
 * tested without a theme or a render context.
 */
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

import type { RenderArgs, RenderContext } from "../tools/builtins.ts";
import { type Slot, summaryFor } from "./summary.ts";

export { useRegistry } from "./summary.ts";

/**
 * No indent.
 *
 * The command, the output and pi's own "Took" all start at the same column, and
 * a note set in from them reads as belonging to the line above rather than to
 * the block. The colour already says it is a note.
 */
export const INDENT = "";

/**
 * The colours the sentence is painted in.
 *
 * Not a grey: `muted` resolves to the same colour as `toolOutput`, so the
 * sentence read as more of the command's output rather than as a note about it.
 * A hue separates it from both the command above and the output between.
 *
 * Two of them, matching what the block already says with its background. A note
 * under a failed command in the colour of success reads as a contradiction.
 */
export const COLOUR: ThemeColor = "success";
export const ERROR_COLOUR: ThemeColor = "error";

/** Which of the two a block's note should use. */
export function colourFor(isError: boolean): ThemeColor {
	return isError ? ERROR_COLOUR : COLOUR;
}

/**
 * Wrap a sentence to the column it will be drawn in, indenting every line.
 *
 * `wrapTextWithAnsi` is what pi's own Text wraps with, so a note breaks where
 * pi would break it. Wrapping before the indent is added and then indenting
 * each line keeps the continuation under the first word rather than under the
 * block's own output.
 */
export function layout(text: string, width: number, theme: Theme, isError = false): string[] {
	const room = width - INDENT.length;
	if (room < 1) return [];
	const colour = colourFor(isError);
	const lines = wrapTextWithAnsi(text, room).map((line) => INDENT + line);
	try {
		return lines.map((line) => theme.fg(colour, line));
	} catch {
		// theme.fg throws while the theme is being replaced, which is when a
		// sentence that arrives late lands. Uncoloured beats absent.
		return lines;
	}
}

export function noting(tool: string) {
	return (
		width: number,
		args: RenderArgs,
		output: string,
		theme: Theme,
		context: RenderContext,
	): string[] | undefined => {
		const text = summaryFor(tool, args, output, context.state as Slot, context.invalidate);
		return text ? layout(text, width, theme, context.isError === true) : undefined;
	};
}
