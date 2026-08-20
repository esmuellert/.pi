/**
 * What the footer costs on a frame, since it draws on every one of them.
 *
 * Run: pnpm test
 *
 * The footer's risk is not the same as a tool block's. A tool block's cost
 * grows with what is on screen; the footer's grows with the session's whole
 * history, because the token counts are summed from it and pi's getBranch()
 * walks the parent chain and builds the array afresh on every call.
 *
 * That is a shape which has already caused one visible stall elsewhere, so it
 * is measured at a session far larger than a real one rather than assumed
 * cheap.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { visibleWidth } from "@earendil-works/pi-tui";
import { frame, overBudget } from "frame-budget";

import { DEFAULT_CONFIG } from "./config.ts";
import { planLayout } from "./layout.ts";

/** A session's entries, chained parent to child the way pi stores them. */
const session = (count: number) => {
	const byId = new Map<string, { id: string; parentId?: string; usage: Record<string, number> }>();
	let parentId: string | undefined;
	for (let index = 0; index < count; index += 1) {
		const id = `entry-${index}`;
		byId.set(id, { id, parentId, usage: { input: 10, output: 20, cacheRead: 5, cacheWrite: 1 } });
		parentId = id;
	}
	return { byId, leafId: parentId };
};

/** pi's own getBranch: walk to the root, then reverse. Rebuilt on every call. */
const branch = ({ byId, leafId }: ReturnType<typeof session>) => {
	const path = [];
	let current = leafId ? byId.get(leafId) : undefined;
	while (current) {
		path.push(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	return path.reverse();
};

const segments = [
	{ text: "claude-sonnet-4-6", color: "accent" },
	{ text: "~/.pi", color: "muted" },
	{ text: "main", color: "muted" },
	{ text: "in 2 · out 41k", color: "muted" },
	{ text: "$1.83", color: "muted" },
	{ text: "cache 98%", color: "muted" },
	{ text: "126k/200k", color: "muted" },
];

const layout = (width: number) =>
	planLayout(() => segments as never, width, {
		separator: DEFAULT_CONFIG.separator,
		maxGap: DEFAULT_CONFIG.maxGap,
		minBar: DEFAULT_CONFIG.minBar,
		maxBar: DEFAULT_CONFIG.maxBar,
		measure: visibleWidth,
	});

describe("a frame with the footer on it", () => {
	it("fits the budget at a session larger than any real one", () => {
		const entries = session(20_000);
		const draw = () => {
			// What render() does: read the session's totals, then lay out.
			let total = 0;
			for (const entry of branch(entries)) total += entry.usage.input! + entry.usage.cacheRead!;
			layout(80);
		};
		assert.equal(overBudget(frame(draw)), undefined);
	});

	it("fits the budget at the narrowest width, where the layout search is widest", () => {
		// Narrow terminals give the bar the most sizes to try.
		const draw = () => {
			for (let width = 20; width <= 60; width += 1) layout(width);
		};
		assert.equal(overBudget(frame(draw)), undefined);
	});
});
