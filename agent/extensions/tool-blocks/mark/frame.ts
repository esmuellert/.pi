/**
 * Put a mark in front of a component the tool itself rendered.
 *
 * pi's own renderers are left to produce the title; this only indents what they
 * returned and writes a glyph into the space that opens up. Nothing about the
 * title's text, colours or hyperlinks is touched, so the tools keep working the
 * way pi ships them and this stays a change of framing.
 */

import type { Component } from "@earendil-works/pi-tui";

/** Columns the mark occupies, including the gap after it. */
export const GUTTER = 3;

/** True when a line carries no visible text, only padding or colour. */
const blank = (line: string) => line.replace(/\u001b\[[0-9;]*m/g, "").trim() === "";

/**
 * `mark` is the already-styled glyph. It must occupy one column: the gutter is
 * fixed, so a wider mark would push the first line out of line with the rest.
 */
export function withMark(inner: Component, mark: string): Component {
	return {
		render(width: number): string[] {
			// The inner component never learns about the gutter, so it wraps and
			// truncates against the width it will actually be drawn in.
			const lines = inner.render(Math.max(1, width - GUTTER));
			// Tools that draw their own frame open with a blank padding line, so
			// the mark goes on the first line that actually says something rather
			// than on line zero. A component with nothing to say keeps its shape.
			const title = lines.findIndex((line) => !blank(line));
			if (title === -1) return lines;
			const pad = " ".repeat(GUTTER);
			return lines.map((line, index) =>
				index === title ? `${mark}${" ".repeat(GUTTER - 1)}${line}` : pad + line,
			);
		},
		invalidate(): void {
			// Required by Component, and called on theme changes. Forgetting to
			// forward it leaves the title painted in the previous theme.
			inner.invalidate();
		},
		...(typeof inner.handleInput === "function"
			? { handleInput: (data: string) => inner.handleInput?.(data) }
			: {}),
		...(inner.wantsKeyRelease === undefined ? {} : { wantsKeyRelease: inner.wantsKeyRelease }),
	};
}
