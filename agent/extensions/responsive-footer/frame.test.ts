/**
 * What the footer costs on a frame, since it draws on every one of them.
 *
 * Run: pnpm test
 *
 * The footer's risk is not the same as a tool block's. A tool block's cost grows
 * with what is on screen; the footer's grows with the session's whole history,
 * because pi's getBranch() walks the parent chain and builds the array afresh on
 * every call, and the token totals are summed from it.
 *
 * That walk is pi's code and linear whatever this extension does. What this
 * extension decides is how many times per frame it asks for it -- so that is
 * what is asserted, by counting the calls rather than timing them. A count is
 * exact on every machine; a millisecond budget is a claim about the machine, and
 * this one failed on a CI runner where four times the session cost twelve times
 * the time for reasons that were allocation and garbage collection rather than
 * anything anyone could act on.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { visibleWidth } from "@earendil-works/pi-tui";
import { growsTooFast, growth } from "frame-budget";

import { DEFAULT_CONFIG } from "./config.ts";
import { planLayout } from "./layout.ts";
import factory from "./index.ts";

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

/** The footer's render(), wired to a session that counts what is asked of it. */
const mount = (entries: ReturnType<typeof session>) => {
	let walks = 0;
	const ctx = {
		sessionManager: {
			getBranch() {
				walks += 1;
				return branch(entries);
			},
			getSessionName: () => undefined,
		},
		getContextUsage: () => ({ percent: 63, tokens: 126_000, contextWindow: 200_000 }),
		hasPendingMessages: () => false,
		cwd: "/repo",
		model: { id: "claude-sonnet-4-6", provider: "anthropic", contextWindow: 200_000 },
		modelRegistry: undefined,
		thinkingLevel: "off",
	};
	// The path pi takes: session_start, then setFooter with a builder it calls
	// with the tui, the theme and its own footer data.
	let made: any;
	const full = {
		...ctx,
		mode: "tui",
		ui: {
			setFooter(build: any) {
				made = build(
					{ requestRender() {} },
					{ fg: (_colour: string, text: string) => text },
					{ onBranchChange: () => () => {}, getGitBranch: () => "main" },
				);
			},
		},
	};
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	factory({ on: (name: string, fn: never) => handlers.set(name, fn) } as never);
	handlers.get("session_start")?.({}, full);
	return { render: (width: number) => made.render(width), walks: () => walks };
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
	it("walks the session once per frame, not once per field", () => {
		// getBranch() rebuilds the whole branch array, so asking twice costs
		// twice. The footer has seven fields, and each of them wants a number
		// that comes out of that walk.
		const footer = mount(session(2_000));
		footer.render(80);
		assert.equal(footer.walks(), 1);
	});

	it("walks it the same number of times however long the session is", () => {
		// A count rather than a duration: the walk itself is pi's and linear,
		// and what would make the footer quadratic is doing it per entry.
		const short = mount(session(100));
		const long = mount(session(20_000));
		short.render(80);
		long.render(80);
		assert.equal(long.walks(), short.walks());
	});

	it("does not walk it at a width too narrow to draw", () => {
		// render() gives up before reading anything at all below four columns.
		const footer = mount(session(100));
		footer.render(2);
		assert.equal(footer.walks(), 0);
	});

	it("costs what the width search is wide, at the narrowest widths", () => {
		// Narrow terminals give the bar the most sizes to try, so this is where
		// the layout search is widest.
		const sweep = (from: number, to: number) => () => {
			for (let width = from; width <= to; width += 1) layout(width);
		};
		assert.equal(
			growsTooFast(growth(sweep(20, 30), sweep(20, 60)), 4, 8),
			undefined,
		);
	});
});
