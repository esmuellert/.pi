/**
 * Put a mark in front of a component the tool itself rendered.
 *
 * pi's own renderers are left to produce the title; this only indents what they
 * returned and writes a glyph into the space that opens up. Nothing about the
 * title's text, colours or hyperlinks is touched, so the tools keep working the
 * way pi ships them and this stays a change of framing.
 */

import type { Component } from "@earendil-works/pi-tui";

import { blank, openingBackground } from "../shared/ansi.ts";

/**
 * Columns the mark occupies, including the gap after it.
 *
 * The mark is one column and the gap is one, which is what pi puts between a
 * verb and its object in every other title. Written as the sum rather than as
 * three so that changing either half cannot leave the two apart.
 */
export const MARK_COLUMNS = 1;
export const MARK_GAP = 1;
export const GUTTER = MARK_COLUMNS + MARK_GAP;



/**
 * `mark` is the already-styled glyph. It must occupy one column: the gutter is
 * fixed, so a wider mark would push the first line out of line with the rest.
 *
 * The gutter is painted in whatever background the line it precedes opens
 * with. The columns opened in front of a block start outside the background
 * that block drew, and show the page through -- a black stripe down the left
 * of every one, most visible on `edit` because it is tall.
 *
 * The background is read from the line rather than worked out. Which one a
 * block wears is the tool's business: pi picks pending, success or error from
 * two flags, but `edit` overrides that and uses the pending background for a
 * settled edit. Reading is right for every tool in every state, including ones
 * not written yet.
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
			return lines.map((line, index) => {
				const gutter = index === title ? mark + " ".repeat(MARK_GAP) : " ".repeat(GUTTER);
				const background = openingBackground(line);
				// A line with no background of its own is the page showing
				// through, and the gutter should show it too.
				return (background ? background + gutter : gutter) + line;
			});
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
