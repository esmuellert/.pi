/**
 * The frame feature: drawn framing instead of a filled rectangle.
 *
 * pi's default shell is a Box(1, 1, bgFn) -- a solid rectangle the full width
 * of the transcript, with a blank filled row above and below. Nothing has to be
 * stripped to replace it: a tool definition can declare `renderShell: "self"`,
 * and pi then draws no background at all and hands the width over. That is how
 * `edit` already works, so this uses pi's own mechanism rather than working
 * around it.
 *
 * What a fill gives away for free is the block's extent -- where it stops is
 * visible without any character saying so. Only `box` states that; `rail` and
 * `bracket` trade it for two rows and two columns.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

import { blank } from "../shared/ansi.ts";
import type { RenderContext } from "../tools/builtins.ts";
import { COLUMNS, type Frame, frame, type Part } from "./draw.ts";

/**
 * The framing's colours, from the same two flags pi reads for its background.
 *
 * A rule is thinner than a fill, so it can carry the outcome without the
 * shouting a full rectangle in the error colour would do.
 */
export function painting(theme: Theme, state: { isPartial: boolean; isError: boolean }) {
	const head = state.isError ? "error" : state.isPartial ? "muted" : "success";
	return {
		rule: (text: string) => theme.fg("borderMuted" as never, text),
		head: (text: string) => theme.fg(head as never, text),
	};
}

/** Drop blank lines from both ends, keeping any in the middle. */
export function trimBlankEdges(lines: readonly string[]): string[] {
	let start = 0;
	let end = lines.length;
	while (start < end && blank(lines[start]!)) start += 1;
	while (end > start && blank(lines[end - 1]!)) end -= 1;
	return lines.slice(start, end);
}

/** Wrap a component so what it renders comes back framed. */
export function framing(kind: Frame, theme: Theme, context: RenderContext, part: Part = "whole") {
	return (inner: Component): Component => ({
		render(width: number): string[] {
			const lines = inner.render(Math.max(1, width - COLUMNS[kind]));
			const empty = lines.every((line) => blank(line));
			// `read` and `edit` say everything in their title and render no
			// result at all. The head has already opened a frame by then, so a
			// tail with nothing in it still has to close one -- otherwise the
			// frame hangs open and runs into the next block.
			if (empty && part !== "tail") return lines;
			if (empty) return frame([], width, kind, painting(theme, context), part);
			// pi's own shells pad with blank rows; framing supplies its own
			// edges, so those rows would sit inside it doing nothing.
			return frame(trimBlankEdges(lines), width, kind, painting(theme, context), part);
		},
		invalidate: () => inner.invalidate(),
		...(typeof inner.handleInput === "function" ? { handleInput: (data: string) => inner.handleInput?.(data) } : {}),
		...(inner.wantsKeyRelease === undefined ? {} : { wantsKeyRelease: inner.wantsKeyRelease }),
	});
}
