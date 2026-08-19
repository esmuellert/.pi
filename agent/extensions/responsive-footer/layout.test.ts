/**
 * Exhaustive layout tests.
 *
 * Run: node --experimental-strip-types --test layout.test.ts
 *
 * The layout engine is pure, so these sweep every width in a wide range and
 * assert structural invariants rather than golden strings.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_CONFIG, type FooterConfig, normalizeConfig } from "./config.ts";
import { clamp, formatCount, measureText, progressBar, shortenHome } from "./format.ts";
import { DEFAULT_LAYOUT_OPTIONS, type Layout, lineText, planLayout, SPREAD_GAP_LIMIT } from "./layout.ts";
import { DEFAULT_PRIORITY, EMPTY_STATE, type FooterState, makeBuilder } from "./segments.ts";

const WIDTHS = Array.from({ length: 397 }, (_, i) => i + 4); // 4 .. 400

const NOMINAL: FooterState = {
	modelId: "claude-opus-5",
	thinkingLevel: "max",
	contextPercent: 40,
	contextTokens: 403_400,
	contextWindow: 1_000_000,
	input: 358,
	output: 194_100,
	cacheRead: 35_800_000,
	cacheWrite: 1_500_000,
	cost: 31.916,
	hitRate: 100,
	usingSubscription: false,
	cwd: "/private/tmp",
	branch: null,
	home: "/home/dev",
};

/** Every state shape the footer may legitimately encounter. */
const STATES: Record<string, FooterState> = {
	nominal: NOMINAL,
	empty: EMPTY_STATE,
	freshSession: { ...EMPTY_STATE, modelId: "gpt-5.1-codex", thinkingLevel: "medium", contextWindow: 200_000 },
	afterCompaction: { ...NOMINAL, contextPercent: null, contextTokens: null },
	zeroPercent: { ...NOMINAL, contextPercent: 0, contextTokens: 0 },
	fullContext: { ...NOMINAL, contextPercent: 100, contextTokens: 1_000_000 },
	overflowPercent: { ...NOMINAL, contextPercent: 137, contextTokens: 1_370_000 },
	noHitRate: { ...NOMINAL, hitRate: null },
	subscription: { ...NOMINAL, usingSubscription: true },
	hugeNumbers: {
		...NOMINAL,
		input: 9_876_543_210,
		output: 1_234_567_890,
		cacheRead: 98_765_432_100,
		cacheWrite: 5_000_000_000,
		cost: 12345.6789,
	},
	longModel: { ...NOMINAL, modelId: "some-provider/an-extremely-long-model-identifier-v2.5-preview-20260819" },
	cjkPath: { ...NOMINAL, cwd: "/home/dev/项目/中文目录名称/子目录", home: "/home/dev" },
	longBranch: { ...NOMINAL, branch: "feature/very-long-branch-name-that-keeps-going-and-going" },
	deepPath: { ...NOMINAL, cwd: "/home/dev/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t", home: "/home/dev" },
	homePath: { ...NOMINAL, cwd: "/home/dev", home: "/home/dev" },
	negativeCost: { ...NOMINAL, cost: 0 },
	nanPercent: { ...NOMINAL, contextPercent: Number.NaN },
};

/** Config permutations, including hostile ones. */
const CONFIGS: Record<string, FooterConfig> = {
	default: DEFAULT_CONFIG,
	oneLine: { ...DEFAULT_CONFIG, maxLines: 1 },
	twoLines: { ...DEFAULT_CONFIG, maxLines: 2 },
	manyLines: { ...DEFAULT_CONFIG, maxLines: 20 },
	noGap: { ...DEFAULT_CONFIG, maxGap: 0 },
	wideGap: { ...DEFAULT_CONFIG, maxGap: 20 },
	noBar: { ...DEFAULT_CONFIG, minBar: 0, maxBar: 0 },
	bigBar: { ...DEFAULT_CONFIG, minBar: 20, maxBar: 40 },
	pipeSep: { ...DEFAULT_CONFIG, separator: " | " },
	hideMost: { ...DEFAULT_CONFIG, hide: ["in", "out", "cache", "hit", "cwd"] },
	hideAll: { ...DEFAULT_CONFIG, hide: ["model", "ctx", "in", "out", "cache", "hit", "cost", "cwd"] },
	invertedPriority: { ...DEFAULT_CONFIG, priority: { ctx: 1, model: 1, cwd: 100 } },
};

function plan(state: FooterState, cfg: FooterConfig, width: number): Layout {
	return planLayout(makeBuilder(state, cfg), width, {
		maxLines: cfg.maxLines,
		separator: cfg.separator,
		maxGap: cfg.maxGap,
		minBar: cfg.minBar,
		maxBar: cfg.maxBar,
	});
}

const allIds = (cfg: FooterConfig) => Object.keys(DEFAULT_PRIORITY).filter((id) => !cfg.hide.includes(id));

describe("format helpers", () => {
	it("formats counts across magnitudes", () => {
		assert.equal(formatCount(0), "0");
		assert.equal(formatCount(999), "999");
		assert.equal(formatCount(1000), "1.0k");
		assert.equal(formatCount(12_345), "12.3k");
		assert.equal(formatCount(1_234_567), "1.2M");
		assert.equal(formatCount(9_876_543_210), "9.9G");
		assert.equal(formatCount(Number.NaN), "—");
		assert.equal(formatCount(-5), "0");
	});

	it("keeps the progress bar at the requested width", () => {
		for (let cells = 0; cells <= 40; cells++) {
			for (const pct of [0, 1, 33.3, 50, 99.9, 100, 137, Number.NaN]) {
				assert.equal(measureText(progressBar(pct, cells)), cells, `cells=${cells} pct=${pct}`);
			}
		}
	});

	it("clamps and shortens home", () => {
		assert.equal(clamp(5, 0, 3), 3);
		assert.equal(clamp(-5, 0, 3), 0);
		assert.equal(shortenHome("/Users/x/proj", "/Users/x"), "~/proj");
		assert.equal(shortenHome("/Users/x", "/Users/x"), "~");
		assert.equal(shortenHome("/opt/other", "/Users/x"), "/opt/other");
		assert.equal(shortenHome("/opt/other", ""), "/opt/other");
	});

	it("counts wide characters as two columns", () => {
		assert.equal(measureText("abc"), 3);
		assert.equal(measureText("中文"), 4);
		assert.equal(measureText("中a"), 3);
	});
});

describe("config validation", () => {
	it("falls back on garbage", () => {
		for (const bad of [null, undefined, 42, "str", [], { maxLines: "x" }, { hide: "no" }, { priority: [1, 2] }]) {
			const c = normalizeConfig(bad);
			assert.equal(typeof c.maxLines, "number");
			assert.ok(Array.isArray(c.hide));
			assert.ok(c.separator.length > 0);
		}
	});

	it("clamps out-of-range values and keeps maxBar >= minBar", () => {
		const c = normalizeConfig({ maxLines: 999, maxGap: -5, minBar: 30, maxBar: 2, ctxWarn: 500 });
		assert.ok(c.maxLines <= 20);
		assert.equal(c.maxGap, 0);
		assert.ok(c.maxBar >= c.minBar);
		assert.ok(c.ctxWarn <= 100);
	});

	it("drops non-numeric priority entries", () => {
		const c = normalizeConfig({ priority: { ctx: 5, bad: "x", nope: null } });
		assert.deepEqual(c.priority, { ctx: 5 });
	});
});

describe("layout invariants across every width", () => {
	for (const [stateName, state] of Object.entries(STATES)) {
		for (const [cfgName, cfg] of Object.entries(CONFIGS)) {
			it(`${stateName} / ${cfgName}`, () => {
				const expected = allIds(cfg);
				for (const width of WIDTHS) {
					const layout = plan(state, cfg, width);
					const where = `${stateName}/${cfgName}@${width}`;

					// Line budget is respected.
					assert.ok(layout.lines.length <= cfg.maxLines, `${where}: ${layout.lines.length} > ${cfg.maxLines}`);

					// Bar stays inside its configured range.
					assert.ok(layout.barCells >= cfg.minBar && layout.barCells <= cfg.maxBar, `${where}: bar ${layout.barCells}`);

					const seen: string[] = [];
					for (const line of layout.lines) {
						assert.ok(line.items.length > 0, `${where}: empty line`);
						for (const item of line.items) seen.push(item.id);

						// Lines fit, unless a single segment is physically wider than the terminal.
						const text = lineText(line, cfg.separator);
						if (line.items.length > 1 || measureText(line.items[0].text) <= width) {
							assert.ok(measureText(text) <= width, `${where}: "${text}" (${measureText(text)}) > ${width}`);
						}
						// Justification: capped when many gaps, free to spread when few.
						const gaps = line.items.length - 1;
						if (gaps > SPREAD_GAP_LIMIT) {
							assert.ok(line.gap <= cfg.maxGap, `${where}: gap ${line.gap} over cap`);
						}
					}

					// No duplicates, and kept + dropped partitions the full set.
					assert.equal(new Set(seen).size, seen.length, `${where}: duplicate segment`);
					const union = [...seen, ...layout.dropped].sort();
					assert.deepEqual(union, [...expected].sort(), `${where}: partition mismatch`);

					// Omission follows priority: nothing dropped outranks anything kept.
					const build = makeBuilder(state, cfg)(cfg.minBar);
					const prioOf = (id: string) => build.find((s) => s.id === id)?.priority ?? 0;
					const minKept = seen.length > 0 ? Math.min(...seen.map(prioOf)) : Number.POSITIVE_INFINITY;
					for (const id of layout.dropped) {
						assert.ok(prioOf(id) <= minKept, `${where}: dropped ${id} outranks a kept segment`);
					}
				}
			});
		}
	}
});

describe("labels are never abbreviated", () => {
	const LABELS: Record<string, RegExp> = {
		in: /^in \S+$/,
		out: /^out \S+$/,
		cache: /^cache \S+$/,
		hit: /^hit \S+$/,
		ctx: /^ctx /,
		model: / · think /,
	};

	it("keeps full wording at every width", () => {
		for (const width of WIDTHS) {
			const layout = plan(NOMINAL, DEFAULT_CONFIG, width);
			for (const line of layout.lines) {
				for (const item of line.items) {
					const re = LABELS[item.id];
					if (re) assert.match(item.text, re, `@${width}: ${item.id} = "${item.text}"`);
				}
			}
		}
	});

	it("renders identical wording at 20 and 200 columns", () => {
		const narrow = plan(NOMINAL, DEFAULT_CONFIG, 20);
		const wide = plan(NOMINAL, DEFAULT_CONFIG, 200);
		const textOf = (l: Layout, id: string) =>
			l.lines.flatMap((x) => x.items).find((s) => s.id === id)?.text.replace(/[▓░]+/g, "BAR");
		for (const id of ["in", "out", "cache", "hit", "cost"]) {
			assert.equal(textOf(narrow, id), textOf(wide, id), `wording drifted for ${id}`);
		}
	});
});

describe("smooth resizing", () => {
	it("line count is non-increasing as width grows", () => {
		let prev = Number.POSITIVE_INFINITY;
		for (const width of WIDTHS) {
			const n = plan(NOMINAL, DEFAULT_CONFIG, width).lines.length;
			assert.ok(n <= prev, `line count rose from ${prev} to ${n} at width ${width}`);
			prev = n;
		}
	});

	it("dropped segment count is non-increasing as width grows", () => {
		let prev = Number.POSITIVE_INFINITY;
		for (const width of WIDTHS) {
			const d = plan(NOMINAL, DEFAULT_CONFIG, width).dropped.length;
			assert.ok(d <= prev, `dropped rose from ${prev} to ${d} at width ${width}`);
			prev = d;
		}
	});

	it("never changes by more than one line per column", () => {
		let prev: Layout | null = null;
		for (const width of WIDTHS) {
			const cur = plan(NOMINAL, DEFAULT_CONFIG, width);
			if (prev) {
				assert.ok(Math.abs(cur.lines.length - prev.lines.length) <= 1, `jump at width ${width}`);
				assert.ok(Math.abs(cur.dropped.length - prev.dropped.length) <= 1, `drop jump at width ${width}`);
			}
			prev = cur;
		}
	});
});

describe("space utilisation", () => {
	it("keeps the bar from dominating a line", () => {
		for (const width of WIDTHS) {
			const layout = plan(NOMINAL, DEFAULT_CONFIG, width);
			// The bar is the elastic part; it must never scale with the terminal.
			assert.ok(layout.barCells <= DEFAULT_CONFIG.maxBar, `@${width}: bar ${layout.barCells}`);
			const ceiling = Math.max(DEFAULT_CONFIG.minBar, width * 0.4);
			assert.ok(layout.barCells <= ceiling, `@${width}: bar ${layout.barCells} exceeds ${ceiling.toFixed(1)}`);
		}
	});

	it("regression: a ~110 column terminal fills its lines instead of inflating the bar", () => {
		// Previously maxBar scaled as width/3, so a 110 column terminal grew a
		// 36 cell bar that swallowed most of the first line.
		for (const width of [100, 110, 120, 140]) {
			const layout = plan(NOMINAL, DEFAULT_CONFIG, width);
			assert.ok(layout.barCells <= DEFAULT_LAYOUT_OPTIONS.maxBar, `@${width}: bar ${layout.barCells}`);
			const ink = layout.lines.reduce((a, l) => {
				const joiner = DEFAULT_CONFIG.separator + " ".repeat(l.gap);
				return a + measureText(l.items.map((s) => s.text).join(joiner));
			}, 0);
			const fill = ink / (layout.lines.length * width);
			assert.ok(fill >= 0.75, `@${width}: fill ${(fill * 100).toFixed(0)}%`);
		}
	});

	it("fills a healthy share of each line once wrapping starts", () => {
		// Measured over widths 20-200: min 79%, mean 91%, nothing below 75%.
		// The remainder is deliberate — gaps stay capped on busy lines because
		// scattered text reads worse than a little trailing slack.
		for (const width of WIDTHS.filter((w) => w >= 30)) {
			const layout = plan(NOMINAL, DEFAULT_CONFIG, width);
			if (layout.lines.length < 2) continue;
			const ink = layout.lines.reduce((a, l) => {
				const joiner = DEFAULT_CONFIG.separator + " ".repeat(l.gap);
				return a + measureText(l.items.map((s) => s.text).join(joiner));
			}, 0);
			const fill = ink / (layout.lines.length * width);
			assert.ok(fill >= 0.75, `@${width}: fill ${(fill * 100).toFixed(0)}%`);
		}
	});
});

describe("degenerate inputs", () => {
	it("survives absurd widths", () => {
		for (const w of [-100, 0, 1, 2, 3, 4, 5, 1000, 100_000]) {
			const layout = plan(NOMINAL, DEFAULT_CONFIG, w);
			assert.ok(Array.isArray(layout.lines));
			assert.ok(layout.lines.length <= DEFAULT_CONFIG.maxLines);
		}
	});

	it("returns nothing when every segment is hidden", () => {
		const layout = plan(NOMINAL, CONFIGS.hideAll, 80);
		assert.equal(layout.lines.length, 0);
	});

	it("honours a single-line budget by dropping, never by wrapping", () => {
		for (const width of WIDTHS) {
			const layout = plan(NOMINAL, CONFIGS.oneLine, width);
			assert.ok(layout.lines.length <= 1, `@${width}: ${layout.lines.length} lines`);
		}
	});

	it("respects inverted priority when dropping", () => {
		const layout = plan(NOMINAL, CONFIGS.invertedPriority, 12);
		if (layout.dropped.length > 0) {
			assert.ok(!layout.dropped.includes("cwd"), "cwd was boosted to top priority but got dropped");
		}
	});
});
