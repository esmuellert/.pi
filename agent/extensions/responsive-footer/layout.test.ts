/**
 * Exhaustive layout tests.
 *
 * Run: node --experimental-strip-types --test layout.test.ts
 *
 * The layout engine is pure, so these sweep every width in a wide range and
 * assert structural invariants rather than golden strings.
 */

import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { DEFAULT_CONFIG, type FooterConfig, normalizeConfig, saveConfigKey } from "./config.ts";
import { clamp, formatCount, measureText, progressBar, shortenHome } from "./format.ts";
import { DEFAULT_LAYOUT_OPTIONS, type Layout, lineText, planLayout, SPREAD_GAP_LIMIT } from "./layout.ts";
import { DEFAULT_HIDDEN, EMPTY_STATE, type FooterState, ICON, makeBuilder } from "./segments.ts";

const WIDTHS = Array.from({ length: 397 }, (_, i) => i + 4); // 4 .. 400

const NOMINAL: FooterState = {
	modelId: "claude-opus-5",
	thinkingLevel: "max",
	compactions: 0,
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
	sessionName: null,
	provider: "github-copilot",
	queued: false,
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
	withBranch: { ...NOMINAL, branch: "main" },
	detachedHead: { ...NOMINAL, branch: "detached" },
	named: { ...NOMINAL, sessionName: "footer-work" },
	queued: { ...NOMINAL, queued: true },
	everything: { ...NOMINAL, branch: "main", sessionName: "footer-work", queued: true, usingSubscription: true },
};

const ALL_IDS = ["cwd", "session", "model", "provider", "ctx", "queue", "in", "out", "cache", "hit", "cost"];

/** Config permutations, including hostile ones. */
const CONFIGS: Record<string, FooterConfig> = {
	default: DEFAULT_CONFIG,
	noGap: { ...DEFAULT_CONFIG, maxGap: 0 },
	wideGap: { ...DEFAULT_CONFIG, maxGap: 20 },
	noBar: { ...DEFAULT_CONFIG, minBar: 0, maxBar: 0 },
	bigBar: { ...DEFAULT_CONFIG, minBar: 20, maxBar: 40 },
	pipeSep: { ...DEFAULT_CONFIG, separator: " | " },
	hideMost: { ...DEFAULT_CONFIG, hide: ["in", "out", "cache", "hit", "cwd"] },
	hideAll: { ...DEFAULT_CONFIG, hide: ALL_IDS },
	showAll: { ...DEFAULT_CONFIG, hide: [] },
	noIcons: { ...DEFAULT_CONFIG, icons: false },
};

function plan(state: FooterState, cfg: FooterConfig, width: number): Layout {
	return planLayout(makeBuilder(state, cfg), width, {
		separator: cfg.separator,
		maxGap: cfg.maxGap,
		minBar: cfg.minBar,
		maxBar: cfg.maxBar,
	});
}

const allIds = (state: FooterState, cfg: FooterConfig) =>
	makeBuilder(state, cfg)(cfg.minBar).map((s) => s.id);

describe("format helpers", () => {
	it("formats counts across magnitudes", () => {
		assert.equal(formatCount(0), "0");
		assert.equal(formatCount(999), "999");
		assert.equal(formatCount(1000), "1.0k");
		assert.equal(formatCount(12_345), "12.3k");
		assert.equal(formatCount(1_234_567), "1.2M");
		// B for billion. G is for gigabytes and gigahertz; a count of 1.2 billion
		// tokens shown as "1.2G" reads as a size, and was reported as a bug.
		assert.equal(formatCount(1_000_000_000), "1.0B");
		assert.equal(formatCount(1_177_546_244), "1.2B");
		assert.equal(formatCount(9_876_543_210), "9.9B");
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
			assert.ok(Array.isArray(c.hide));
			assert.equal(typeof c.maxGap, "number");
			assert.ok(c.separator.length > 0);
		}
	});

	it("clamps out-of-range values and keeps maxBar >= minBar", () => {
		const c = normalizeConfig({ maxGap: -5, minBar: 30, maxBar: 2, ctxWarn: 500 });
		assert.equal(c.maxGap, 0);
		assert.ok(c.maxBar >= c.minBar);
		assert.ok(c.ctxWarn <= 100);
	});

	it("round-trips a saved key without losing the rest of the file", () => {
		const tmp = join(tmpdir(), `footer-test-${process.pid}.json`);
		try {
			writeFileSync(tmp, JSON.stringify({ hide: ["cwd"], maxGap: 3 }));
			saveConfigKey("icons", false, tmp);
			const c = normalizeConfig(JSON.parse(readFileSync(tmp, "utf-8")));
			assert.equal(c.icons, false);
			assert.deepEqual(c.hide, ["cwd"], "unrelated keys must survive");
			assert.equal(c.maxGap, 3);
		} finally {
			rmSync(tmp, { force: true });
		}
	});

	it("saves over an unreadable config rather than refusing", () => {
		const tmp = join(tmpdir(), `footer-bad-${process.pid}.json`);
		try {
			writeFileSync(tmp, "{not json");
			saveConfigKey("icons", true, tmp);
			assert.equal(normalizeConfig(JSON.parse(readFileSync(tmp, "utf-8"))).icons, true);
		} finally {
			rmSync(tmp, { force: true });
		}
	});

	it("keeps hide as a string array", () => {
		const c = normalizeConfig({ hide: ["cwd", 42, null, "cost"] });
		assert.deepEqual(c.hide, ["cwd", "cost"]);
	});
});

describe("layout invariants across every width", () => {
	for (const [stateName, state] of Object.entries(STATES)) {
		for (const [cfgName, cfg] of Object.entries(CONFIGS)) {
			it(`${stateName} / ${cfgName}`, () => {
				const expected = allIds(state, cfg);
				for (const width of WIDTHS) {
					const layout = plan(state, cfg, width);
					const where = `${stateName}/${cfgName}@${width}`;

					// Line count is naturally capped at one line per segment.
					assert.ok(layout.lines.length <= expected.length + 1, `${where}: ${layout.lines.length} lines`);

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

					// Nothing is ever dropped or duplicated: every visible field renders.
					assert.equal(new Set(seen).size, seen.length, `${where}: duplicate segment`);
					assert.deepEqual([...seen].sort(), [...expected].sort(), `${where}: missing or extra segment`);
				}
			});
		}
	}
});

describe("labels are never abbreviated", () => {
	const LABELS: Record<string, RegExp> = {
		in: /^in \S+$/,
		out: /^out \S+$/,
		cache: new RegExp(`^(cache|${ICON.cache}) \\S+$`),
		hit: /^hit \S+$/,
		ctx: /^ctx /,
		model: / · \S+$/,
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


	it("never changes by more than one line per column", () => {
		let prev: Layout | null = null;
		for (const width of WIDTHS) {
			const cur = plan(NOMINAL, DEFAULT_CONFIG, width);
			if (prev) {
				assert.ok(Math.abs(cur.lines.length - prev.lines.length) <= 1, `jump at width ${width}`);
			}
			prev = cur;
		}
	});
});

describe("alignment", () => {
	it("is left aligned by default", () => {
		// Justified gaps recompute whenever a value changes, so every field on the
		// line shifts. Left alignment keeps positions stable and scannable.
		assert.equal(DEFAULT_CONFIG.maxGap, 0);
		assert.equal(DEFAULT_LAYOUT_OPTIONS.maxGap, 0);
		for (const width of WIDTHS) {
			for (const line of plan(NOMINAL, DEFAULT_CONFIG, width).lines) {
				assert.equal(line.gap, 0, `@${width}: gap ${line.gap}`);
			}
		}
	});

	it("still spreads when maxGap is opted into", () => {
		const cfg = { ...DEFAULT_CONFIG, maxGap: 4 };
		const anySpread = WIDTHS.some((w) => plan(NOMINAL, cfg, w).lines.some((l) => l.gap > 0));
		assert.ok(anySpread, "maxGap>0 never produced a gap");
	});
});

describe("space utilisation", () => {
	it("keeps the bar from dominating a line", () => {
		for (const width of WIDTHS) {
			const layout = plan(NOMINAL, DEFAULT_CONFIG, width);
			// The bar is the elastic part; it must never scale with the terminal.
			assert.ok(layout.barCells <= DEFAULT_LAYOUT_OPTIONS.maxBar, `@${width}: bar ${layout.barCells}`);
			const ceiling = Math.max(DEFAULT_CONFIG.minBar, width * 0.4);
			assert.ok(layout.barCells <= ceiling, `@${width}: bar ${layout.barCells} exceeds ${ceiling.toFixed(1)}`);
		}
	});

	it("regression: a ~110 column terminal does not inflate the bar", () => {
		// maxBar used to scale as width/3, so a 110 column terminal grew a 36
		// cell bar that swallowed most of the first line.
		for (const width of [100, 110, 120, 140]) {
			const layout = plan(NOMINAL, DEFAULT_CONFIG, width);
			assert.ok(layout.barCells <= DEFAULT_LAYOUT_OPTIONS.maxBar, `@${width}: bar ${layout.barCells}`);
		}
	});


	it("picks the bar width that fills the terminal best", () => {
		// The bar is scored by fill, not evenness. Evenness is `balance`'s job and
		// runs first; scoring the bar that way too meant a bar sitting on the
		// longest line could only worsen the spread by growing, so the minimum
		// always won and left the bar tiny beside a half-empty line.
		//
		// The earlier hazard this replaced -- a bar taking its ceiling and pushing
		// a field onto the next line -- is covered by the line-count guard, which
		// the sweep below holds to by only comparing layouts of equal height.
		for (const width of WIDTHS.filter((w) => w >= 30)) {
			const chosen = plan(NOMINAL, DEFAULT_CONFIG, width);
			const unusedOf = (l: Layout) => {
				const lens = l.lines.map((x) => measureText(lineText(x, DEFAULT_CONFIG.separator)));
				return width - Math.max(...lens);
			};
			// Only bars planLayout would actually reach: it stops at the share-of-
			// width ceiling, and at the first bar whose segments overflow the line.
			const ceiling = Math.min(DEFAULT_CONFIG.maxBar, Math.max(DEFAULT_CONFIG.minBar, Math.floor(width * 0.4)));
			for (let bar = DEFAULT_CONFIG.minBar; bar <= ceiling; bar++) {
				const segs = makeBuilder(NOMINAL, DEFAULT_CONFIG)(bar);
				if (segs.some((s) => measureText(s.text) > width)) break;
				const alt = planLayout(makeBuilder(NOMINAL, DEFAULT_CONFIG), width, {
					separator: DEFAULT_CONFIG.separator,
					maxGap: DEFAULT_CONFIG.maxGap,
					minBar: bar,
					maxBar: bar,
				});
				if (alt.lines.length !== chosen.lines.length) continue;
				assert.ok(unusedOf(chosen) <= unusedOf(alt), `@${width}: bar ${chosen.barCells} fills worse than ${bar}`);
			}
		}
	});

	it("never adds a line to widen the bar", () => {
		// The reason fill is safe to optimise: whatever the bar does, the block
		// must not grow taller than it would at the narrowest bar.
		for (const width of WIDTHS.filter((w) => w >= 30)) {
			const atMin = planLayout(makeBuilder(NOMINAL, DEFAULT_CONFIG), width, {
				separator: DEFAULT_CONFIG.separator,
				maxGap: DEFAULT_CONFIG.maxGap,
				minBar: DEFAULT_CONFIG.minBar,
				maxBar: DEFAULT_CONFIG.minBar,
			});
			const chosen = plan(NOMINAL, DEFAULT_CONFIG, width);
			assert.equal(
				chosen.lines.length,
				atMin.lines.length,
				`@${width}: bar ${chosen.barCells} used ${chosen.lines.length} lines, min bar used ${atMin.lines.length}`,
			);
		}
	});

	it("balances line lengths instead of stranding a short last line", () => {
		// Measured where every segment fits (width >= 26): evenness min 33%, mean 72%.
		// Left alignment leaves trailing space by design; what matters is that the
		// wrap does not dump a lone segment on the final line.
		for (const width of WIDTHS.filter((w) => w >= 30)) {
			const layout = plan(NOMINAL, DEFAULT_CONFIG, width);
			if (layout.lines.length < 2) continue;
			const lens = layout.lines.map((l) => measureText(lineText(l, DEFAULT_CONFIG.separator)));
			const evenness = Math.min(...lens) / Math.max(...lens);
			assert.ok(evenness >= 0.3, `@${width}: evenness ${(evenness * 100).toFixed(0)}%`);
		}
	});
});

describe("icons", () => {
	it("uses glyphs only where the meaning is conventional", () => {
		const withIcons = makeBuilder({ ...NOMINAL, branch: "main" }, DEFAULT_CONFIG)(6);
		const text = (id: string) => withIcons.find((s) => s.id === id)!.text;
		assert.ok(text("cwd").startsWith(ICON.folder), "cwd should lead with a folder glyph");
		assert.ok(text("cwd").includes(ICON.branch), "branch should use its glyph");
		assert.ok(text("cache").startsWith(ICON.cache), "cache should lead with a database glyph");
		// Metrics keep written labels: no shared icon vocabulary exists for them.
		for (const id of ["in", "out", "hit"]) {
			assert.match(text(id), /^[a-z]+ /, `${id} should keep its written label`);
		}
	});

	it("falls back to words when icons are off", () => {
		const plain = makeBuilder({ ...NOMINAL, branch: "main" }, { ...DEFAULT_CONFIG, icons: false })(6);
		const all = plain.map((s) => s.text).join(" ");
		for (const glyph of Object.values(ICON)) assert.ok(!all.includes(glyph), `${glyph} leaked with icons off`);
		assert.ok(plain.find((s) => s.id === "cache")!.text.startsWith("cache "));
	});
});

describe("field order", () => {
	it("orders by stability, not importance", () => {
		// Left-aligned text means a field that changes width pushes everything to
		// its right, so rarely-changing fields lead and per-turn counters trail.
		const ids = makeBuilder({ ...NOMINAL, branch: "main" }, { ...DEFAULT_CONFIG, hide: [] })(6).map((s) => s.id);
		const at = (id: string) => ids.indexOf(id);
		assert.ok(at("cwd") === 0, "cwd should anchor the line, like a shell prompt");
		assert.ok(at("model") < at("ctx"), "model changes less often than context");
		for (const volatile of ["in", "out", "cache", "hit", "cost"]) {
			assert.ok(at("ctx") < at(volatile), `${volatile} is volatile and must trail ctx`);
		}
	});

	it("never drops a field, however narrow the terminal", () => {
		const cfg = { ...DEFAULT_CONFIG, hide: [] };
		const expected = makeBuilder(NOMINAL, cfg)(cfg.minBar).length;
		for (const width of WIDTHS) {
			const kept = plan(NOMINAL, cfg, width).lines.flatMap((l) => l.items).length;
			assert.equal(kept, expected, `@${width}: rendered ${kept} of ${expected}`);
		}
	});

	it("shows git branch and hides optional fields by default", () => {
		const cwdOf = (state: FooterState, cfg = DEFAULT_CONFIG) =>
			makeBuilder(state, cfg)(6).find((s) => s.id === "cwd")!.text;

		assert.match(cwdOf({ ...NOMINAL, branch: "main" }), new RegExp(`${ICON.branch} main$`));
		assert.match(cwdOf({ ...NOMINAL, branch: "detached" }), new RegExp(`${ICON.branch} detached$`));
		// Without icons the branch falls back to parentheses.
		const plain = { ...DEFAULT_CONFIG, icons: false };
		assert.match(cwdOf({ ...NOMINAL, branch: "main" }, plain), /\(main\)$/);
		assert.equal(cwdOf({ ...NOMINAL, branch: null }, plain), "/private/tmp");

		const ids = makeBuilder({ ...NOMINAL, sessionName: "x", queued: true }, DEFAULT_CONFIG)(6).map((s) => s.id);
		for (const id of DEFAULT_HIDDEN) assert.ok(!ids.includes(id), `${id} should be hidden by default`);
	});

	it("renders optional fields once unhidden, and omits blank ones", () => {
		const cfg = { ...DEFAULT_CONFIG, hide: [] };
		const full = makeBuilder({ ...NOMINAL, sessionName: "work", queued: true }, cfg)(6).map((s) => s.id);
		for (const id of DEFAULT_HIDDEN) assert.ok(full.includes(id), `${id} should appear when unhidden`);

		// Empty values must not leave an empty slot behind.
		const blank = makeBuilder({ ...NOMINAL, sessionName: null, queued: false, provider: "" }, cfg)(6).map((s) => s.id);
		for (const id of DEFAULT_HIDDEN) assert.ok(!blank.includes(id), `${id} should vanish when empty`);
	});

	it("marks subscription usage on the cost field", () => {
		const sub = makeBuilder({ ...NOMINAL, usingSubscription: true }, DEFAULT_CONFIG)(6);
		assert.match(sub.find((s) => s.id === "cost")!.text, / sub$/);
		const paid = makeBuilder({ ...NOMINAL, usingSubscription: false }, DEFAULT_CONFIG)(6);
		assert.doesNotMatch(paid.find((s) => s.id === "cost")!.text, / sub$/);
	});
});

describe("degenerate inputs", () => {
	it("survives absurd widths", () => {
		for (const w of [-100, 0, 1, 2, 3, 4, 5, 1000, 100_000]) {
			const layout = plan(NOMINAL, DEFAULT_CONFIG, w);
			assert.ok(Array.isArray(layout.lines));
		}
	});

	it("returns nothing when every segment is hidden", () => {
		const layout = plan(NOMINAL, CONFIGS.hideAll, 80);
		assert.equal(layout.lines.length, 0);
	});


});

describe("compaction count", () => {
	const compacted = (n: number): FooterState => ({ ...NOMINAL, compactions: n });

	it("appears only once a session has compacted", () => {
		assert.ok(!ids(compacted(0)).includes("compact"));
		assert.ok(ids(compacted(1)).includes("compact"));
	});

	it("shows the count, and a word when icons are off", () => {
		assert.equal(text(compacted(3), DEFAULT_CONFIG), `${ICON.compact} 3`);
		assert.equal(text(compacted(3), CONFIGS.noIcons), "compacted 3");
		// Three columns rather than nine: this is read on a 53-column terminal,
		// and the count is a depth of loss, not a number anyone acts on.
		assert.equal(measureText(text(compacted(3), DEFAULT_CONFIG)), 3);
	});

	it("follows the context bar", () => {
		const order = ids(compacted(2));
		assert.equal(order[order.indexOf("compact") - 1], "ctx");
	});
});

function ids(state: FooterState): string[] {
	return makeBuilder(state, DEFAULT_CONFIG)(8).map((s) => s.id);
}

function text(state: FooterState, cfg: FooterConfig): string {
	return makeBuilder(state, cfg)(8).find((s) => s.id === "compact")?.text ?? "";
}
