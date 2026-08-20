/**
 * The mark feature: one glyph in front of each tool block.
 *
 * Where it sits marks the start of the header, its shape says which tool ran,
 * and its colour says whether the call is still running, worked, or failed.
 *
 * The glyph carries the outcome rather than the tool's name because the title
 * already opens with the name — "read ~/file", "$ command" — so a chip with the
 * word in it would say everything twice. What the title never says is how the
 * call went.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

import type { RenderContext, ToolName } from "../tools/builtins.ts";
import type { MarkStyle } from "./config.ts";
import { ICON, LETTER, OUTCOME_COLOR, outcomeOf } from "./icons.ts";
import { withMark } from "./frame.ts";

/** The styled glyph for a tool in a given state. */
export function markFor(tool: ToolName, style: MarkStyle, theme: Theme, state: { isPartial: boolean; isError: boolean }): string {
	const glyph = style === "letters" ? LETTER[tool] : ICON[tool];
	return theme.fg(OUTCOME_COLOR[outcomeOf(state)] as never, glyph);
}

/** A Presentation.frame that puts the mark in front of whatever pi rendered. */
export function marking(tool: ToolName, style: () => MarkStyle) {
	return (inner: Component, _args: unknown, theme: Theme, context: RenderContext): Component => {
		if (style() === "off") return inner;
		return withMark(inner, markFor(tool, style(), theme, context));
	};
}
