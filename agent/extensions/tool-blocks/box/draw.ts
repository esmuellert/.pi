/**
 * Drawing the framing, given the lines to frame.
 *
 * Kept apart from the wiring so the shapes can be tested without a component.
 *
 * pi renders a tool's title and its result as two sibling components, and an
 * extension wraps each on its own -- nothing sees both. So a frame that closes
 * is drawn in halves: the title's component opens it, the result's closes it,
 * and they meet because the two render adjacently.
 */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Which half of the framing to draw. */
export type Part = "whole" | "head" | "tail";

/**
 * How a block is set apart from the page.
 *
 * `rail` and `bracket` are not inventions: pi's own markdown gives a quote a
 * `│` rail and a code block a `┌─` corner, both in a border colour with no
 * fill. `box` encloses, which is the only one that states the block's extent
 * on all four sides -- and the only one that spends two rows and two columns
 * on doing so.
 */
export type Frame = "rail" | "bracket" | "box";

/** What each frame costs the content, in columns. */
export const COLUMNS: Readonly<Record<Frame, number>> = {
	rail: 2, // a rule and a space
	bracket: 2,
	box: 4, // the same on both sides
};

const VERTICAL = "│";
const HORIZONTAL = "─";
/** Heavier than the body's rule, so the head reads as the head. */
const VERTICAL_HEAD = "┃";
const TOP_LEFT = "╭";
const TOP_RIGHT = "╮";
const BOTTOM_LEFT = "╰";
const BOTTOM_RIGHT = "╯";
/** How far a bracket's foot runs. Long enough to read as a foot, short enough not to rule off the page. */
const FOOT = 3;

export type Paint = {
	/** The frame's own colour. */
	readonly rule: (text: string) => string;
	/** The head's colour, which carries the outcome. */
	readonly head: (text: string) => string;
};

/**
 * Frame `lines` to `width` columns.
 *
 * Content is passed through untouched: what colour it is was decided by
 * whoever produced it.
 */
export function frame(
	lines: readonly string[],
	width: number,
	kind: Frame,
	paint: Paint,
	part: Part = "whole",
): string[] {
	const inner = width - COLUMNS[kind];
	if (inner < 1) return [...lines];
	const opens = part !== "tail";
	const closes = part !== "head";
	// The caller renders at the inner width, but a component is free to return
	// something wider -- a pre-wrapped table, a line it would not break. The
	// frame's own columns are not negotiable, so anything longer is cut.
	const fit = (line: string) => (visibleWidth(line) > inner ? truncateToWidth(line, inner) : line);

	if (kind === "rail") {
		return lines.map((line, index) =>
			(opens && index === 0 ? paint.head(VERTICAL_HEAD) : paint.rule(VERTICAL)) + " " + fit(line),
		);
	}

	if (kind === "bracket") {
		const body = lines.map((line, index) =>
			(opens && index === 0 ? paint.head(TOP_LEFT) : paint.rule(VERTICAL)) + " " + fit(line),
		);
		return closes ? [...body, paint.rule(BOTTOM_LEFT + HORIZONTAL.repeat(FOOT))] : body;
	}

	// Every row is `width` columns: two rules and inner + 2 between them.
	const span = inner + 2;
	const body = lines.map((line) => {
		const cut = fit(line);
		const room = Math.max(0, inner - visibleWidth(cut));
		return paint.rule(VERTICAL) + " " + cut + " ".repeat(room) + " " + paint.rule(VERTICAL);
	});
	return [
		...(opens ? [paint.head(TOP_LEFT + HORIZONTAL.repeat(span) + TOP_RIGHT)] : []),
		...body,
		...(closes ? [paint.rule(BOTTOM_LEFT + HORIZONTAL.repeat(span) + BOTTOM_RIGHT)] : []),
	];
}
