/**
 * Which glyph marks which tool, and what its colour says.
 *
 * The chip does not repeat the tool's name: pi's titles already start with it
 * ("read ~/file", "$ command"), so a text chip would say everything twice. It
 * carries the one thing the title never says instead — how the call turned out
 * — while its shape keeps saying which tool ran.
 *
 * The codepoints are Font Awesome, the range every Nerd Font carries and the
 * same one the footer already draws from.
 */

import type { ToolName } from "../tools/builtins.ts";

export const ICON: Readonly<Record<ToolName, string>> = {
	read: "\uf15c", // file-text
	bash: "\uf120", // terminal
	edit: "\uf044", // pencil-square
	write: "\uf0c7", // save
	ls: "\uf07b", // folder
	grep: "\uf002", // search
	find: "\uf002", // search
};

/**
 * Plain text stand-ins, for a terminal whose font has no Nerd Font glyphs.
 *
 * A missing glyph still measures one column, so it shows as a box rather than
 * breaking the layout, but a box says less than a letter does.
 */
export const LETTER: Readonly<Record<ToolName, string>> = {
	read: "r",
	bash: "$",
	edit: "e",
	write: "w",
	ls: "l",
	grep: "g",
	find: "f",
};

/** The theme colour a mark takes, given where the call has got to. */
export type Outcome = "running" | "ok" | "failed";

export const OUTCOME_COLOR: Readonly<Record<Outcome, string>> = {
	running: "muted",
	ok: "success",
	failed: "error",
};

export function outcomeOf(state: { isPartial: boolean; isError: boolean }): Outcome {
	if (state.isError) return "failed";
	return state.isPartial ? "running" : "ok";
}
