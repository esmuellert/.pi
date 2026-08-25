import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { duration, fit, ICON, layout, money, parts, SEPARATOR, tokens } from "./format.ts";
import { add, close, empty, type Stats, worthShowing } from "./stats.ts";

const wide = (s: string) => s.length;

const stats = (over: Partial<Stats> = {}): Stats => ({
	tools: 6, ms: 89_000, tokensIn: 1_902_525, tokensOut: 3300, cacheHit: 0.94, cost: 3.03, ...over,
});

describe("gathering what a reply cost", () => {
	it("spans the whole reply, not one turn", () => {
		// pi emits a turn per model call; a reply in the session this was built
		// in runs four at the median and 113 at the worst.
		const t = empty(1000);
		add(t, { input: 10, output: 100, cacheRead: 5000, cost: 1 }, 2);
		add(t, { input: 20, output: 200, cacheRead: 6000, cost: 2 }, 3);
		const s = close(t, 90_000);
		assert.equal(s.tools, 5);
		assert.equal(s.tokensOut, 300);
		assert.equal(s.cost, 3);
		assert.equal(s.ms, 89_000);
	});

	it("counts everything sent, cache included", () => {
		// The whole context goes over on every turn. Reporting only the fresh
		// tokens would say 8 for a reply that sent 1.9 million.
		const t = empty(0);
		add(t, { input: 8, cacheRead: 1_700_000, cacheWrite: 5600 }, 0);
		const s = close(t, 0);
		assert.equal(s.tokensIn, 1_705_608);
		assert.equal(s.cacheHit, 1_700_000 / 1_705_608);
	});

	it("takes cost whether pi reports a number or an object", () => {
		const a = empty(0); add(a, { cost: 1.5 }, 0);
		const b = empty(0); add(b, { cost: { total: 1.5 } }, 0);
		assert.equal(close(a, 0).cost, close(b, 0).cost);
	});

	it("has no hit rate when nothing was sent", () => {
		assert.equal(close(empty(0), 0).cacheHit, null);
	});

	it("says nothing about a reply that did nothing", () => {
		assert.equal(worthShowing(close(empty(0), 0)), false);
		assert.equal(worthShowing(stats()), true);
	});
});

describe("the figures", () => {
	it("never spends more than three characters on a number", () => {
		// A footer that grows with the numbers pushes the useful parts off the
		// end of a narrow line.
		for (const [ms, want] of [[8000, "8s"], [59_400, "59s"], [89_000, "1m29s"], [14_568_000, "4h02m"]] as const) {
			assert.equal(duration(ms), want);
		}
	});

	it("scales token counts to the size of the number", () => {
		assert.equal(tokens(840), "840");
		assert.equal(tokens(3300), "3.3k");
		assert.equal(tokens(84_000), "84k");
		assert.equal(tokens(1_902_525), "1.9M");
	});

	it("keeps a fraction of a cent visible below a dollar", () => {
		// Most replies here cost under a dollar; cents alone print $0.00 for
		// half of them.
		assert.equal(money(3.034), "$3.03");
		assert.equal(money(0.087), "$0.087");
		assert.equal(money(0.5), "$0.5", "a trailing zero claims precision the number lacks");
		assert.equal(money(12), "$12");
	});
});

describe("what the line carries", () => {
	it("leads with what a reader scans for", () => {
		assert.deepEqual(parts(stats()).slice(0, 3), [`${ICON.tools} 6`, "1m29s", "$3.03"]);
	});

	it("spends one column on each glyph", () => {
		// A glyph that measures two would shift everything after it, and a font
		// without these draws a box that still measures one.
		for (const glyph of Object.values(ICON)) assert.equal([...glyph].length, 1);
	});

	it("leaves out what did not happen", () => {
		const bare = parts(stats({ tools: 0, cost: 0, cacheHit: null, tokensIn: 0, tokensOut: 0 }));
		assert.deepEqual(bare, ["1m29s"]);
	});
});

describe("fitting a narrow terminal", () => {
	it("drops from the end, so the first facts stay put", () => {
		// Reordering under pressure would move the same figure around as the
		// window is resized.
		const all = parts(stats());
		const narrow = fit(all, 24, wide);
		assert.ok(narrow.startsWith(`${ICON.tools} 6`), narrow);
		assert.ok(wide(narrow) <= 24);
	});

	it("never abbreviates a part to squeeze it in", () => {
		// A shortened figure is a figure the reader has to decode. Checked as a
		// prefix rather than by splitting: the separator is a single space and
		// several parts contain one, so splitting would cut them in half.
		const all = parts(stats());
		for (let width = 1; width <= 80; width += 1) {
			const line = fit(all, width, wide);
			if (!line) continue;
			const take = all.findIndex((_, i) => all.slice(0, i + 1).join(SEPARATOR) === line);
			assert.ok(take >= 0, `width ${width} produced ${line}, which is no prefix of the parts`);
		}
	});

	it("right-aligns to the given width", () => {
		const line = layout(stats(), 60, wide);
		assert.equal(wide(line), 60);
		assert.equal(line.trimStart(), line.trim());
		assert.ok(line.startsWith(" "));
	});

	it("returns nothing rather than overflowing", () => {
		// Narrower than the first part, which is a glyph, a space and a digit.
		assert.equal(layout(stats(), 2, wide), "");
		assert.ok(wide(layout(stats(), 40, wide)) <= 40);
	});

	it("survives an entry written before a field existed", () => {
		// Old entries lack whatever was added since; a renderer that throws is
		// drawn by pi as a red error box.
		const old = { tools: 4, ms: 1000 } as unknown as Stats;
		assert.doesNotThrow(() => layout({ ...old, tokensIn: 0, tokensOut: 0, cacheHit: null, cost: 0 }, 40, wide));
	});
});
