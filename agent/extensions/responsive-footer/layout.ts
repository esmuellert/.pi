/**
 * Pure layout engine.
 *
 * Two contracts:
 *   - wording is never abbreviated, at any width
 *   - every visible field is always rendered, at any width
 *
 * A narrow terminal is short on columns but rich on rows, so the only thing
 * that gives is the wrap. The line count is self-limiting: in the worst case
 * each segment takes its own line, which needs a terminal too narrow to use.
 *
 * Elasticity is applied in this order:
 *   1. wrapping        segments flow like words in a paragraph
 *   2. context bar     grows within a small absolute range, never dominates
 *   3. justification   leftover slack shared between gaps (off by default)
 *
 * Everything here is deterministic and side-effect free so it can be tested
 * exhaustively across widths and configurations.
 */

import { measureText } from "./format.ts";

export interface Segment {
	id: string;
	text: string;
	color: string;
}

/** Rebuilds the segment list for a given context-bar width. */
export type SegmentBuilder = (barCells: number) => Segment[];

export interface LayoutOptions {
	separator: string;
	maxGap: number;
	minBar: number;
	/**
	 * Absolute ceiling for the context bar. A bar conveys roughly one digit of
	 * information, so letting it scale with terminal width makes it swallow
	 * whole lines on wide screens. Slack is better spent on justification.
	 */
	maxBar: number;
	measure?: (s: string) => number;
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
	separator: "  ",
	maxGap: 0,
	minBar: 6,
	maxBar: 14,
};

export interface LayoutLine {
	items: Segment[];
	/** Extra spaces appended to each separator on this line. */
	gap: number;
}

export interface Layout {
	lines: LayoutLine[];
	barCells: number;
}

interface Ctx {
	measure: (s: string) => number;
	sep: number;
	width: number;
}

/** Width of segments [i, j) joined by the separator. */
function span(texts: string[], i: number, j: number, c: Ctx): number {
	let w = 0;
	for (let k = i; k < j; k++) w += (k === i ? 0 : c.sep) + c.measure(texts[k]);
	return w;
}

/** Greedy flow: fill each line as far as it goes, then wrap. Optimal for line count. */
export function flow(texts: string[], c: Ctx): number[][] {
	const lines: number[][] = [];
	let cur: number[] = [];
	let used = 0;
	for (let i = 0; i < texts.length; i++) {
		const w = c.measure(texts[i]);
		const cost = cur.length === 0 ? w : c.sep + w;
		if (cur.length > 0 && used + cost > c.width) {
			lines.push(cur);
			cur = [i];
			used = w;
		} else {
			cur.push(i);
			used += cost;
		}
	}
	if (cur.length > 0) lines.push(cur);
	return lines;
}

/**
 * Re-wrap into exactly `lineCount` lines.
 *
 * The cost of a line is not its raw slack but the slack that justification
 * cannot absorb: whitespace spread between items is free, whitespace left
 * hanging off the right edge is not. Minimising the squared excess therefore
 * packs lines so that each one can actually be filled.
 * Returns null when no such packing exists (caller keeps the greedy one).
 */
export function balance(texts: string[], lineCount: number, c: Ctx, maxGap: number): number[][] | null {
	const n = texts.length;
	if (lineCount <= 1 || lineCount >= n) return null;
	const cost = new Map<string, number>();
	const cut = new Map<string, number>();

	const excess = (i: number, j: number): number => {
		const ink = span(texts, i, j, c);
		if (ink > c.width) return Number.POSITIVE_INFINITY;
		const absorbable = Math.max(0, j - i - 1) * maxGap;
		return Math.max(0, c.width - ink - absorbable) ** 2;
	};

	const solve = (i: number, k: number): number => {
		if (k === 1) return excess(i, n);
		const key = `${i}|${k}`;
		const memo = cost.get(key);
		if (memo !== undefined) return memo;
		let best = Number.POSITIVE_INFINITY;
		let bestJ = -1;
		for (let j = i + 1; j <= n - (k - 1); j++) {
			const head = excess(i, j);
			if (!Number.isFinite(head)) break;
			const rest = solve(j, k - 1);
			if (!Number.isFinite(rest)) continue;
			const total = head + rest;
			if (total < best) {
				best = total;
				bestJ = j;
			}
		}
		cost.set(key, best);
		cut.set(key, bestJ);
		return best;
	};

	if (!Number.isFinite(solve(0, lineCount))) return null;

	const out: number[][] = [];
	let i = 0;
	for (let k = lineCount; k > 1; k--) {
		const j = cut.get(`${i}|${k}`);
		if (j === undefined || j <= i || j >= n) return null;
		out.push(Array.from({ length: j - i }, (_, x) => x + i));
		i = j;
	}
	out.push(Array.from({ length: n - i }, (_, x) => x + i));
	return out;
}

/**
 * Extra spaces per gap so a line fills the width without scattering items.
 *
 * With one or two gaps, spreading to the edges reads as deliberate alignment
 * (the same left/right split the built-in footer uses), so the cap is lifted.
 * With more gaps, wide spacing just looks scattered, so `maxGap` applies.
 */
export const SPREAD_GAP_LIMIT = 2;

export function gapFor(texts: string[], line: number[], c: Ctx, maxGap: number): number {
	if (line.length < 2 || maxGap <= 0) return 0;
	let ink = 0;
	for (const i of line) ink += c.measure(texts[i]);
	const gaps = line.length - 1;
	const slack = c.width - ink - gaps * c.sep;
	if (slack <= 0) return 0;
	const cap = gaps <= SPREAD_GAP_LIMIT ? Number.POSITIVE_INFINITY : maxGap;
	return Math.max(0, Math.min(cap, Math.floor(slack / gaps)));
}

/** Longest minus shortest line: a balance measure that ink volume cannot inflate. */
function spread(texts: string[], lines: number[][], c: Ctx): number {
	if (lines.length < 2) return 0;
	let lo = Number.POSITIVE_INFINITY;
	let hi = 0;
	for (const line of lines) {
		const w = span(texts, line[0], line[line.length - 1] + 1, c);
		if (w < lo) lo = w;
		if (w > hi) hi = w;
	}
	return hi - lo;
}

export function planLayout(build: SegmentBuilder, width: number, options: Partial<LayoutOptions> = {}): Layout {
	const opts: LayoutOptions = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
	const measure = opts.measure ?? measureText;
	const minBar = Math.max(0, Math.floor(opts.minBar));
	const maxBar = Math.max(minBar, Math.floor(opts.maxBar));
	const c: Ctx = { measure, sep: measure(opts.separator), width: Math.max(1, Math.floor(width)) };

	// Every visible segment is always rendered. Narrow terminals get more lines,
	// never fewer fields: the line count is naturally capped at one line per
	// segment, which only happens on terminals too narrow to use anyway.
	const base = build(minBar);
	if (base.length === 0) return { lines: [], barCells: minBar };
	const lineCount = flow(base.map((s) => s.text), c).length;

	// Pick the bar width that wraps best, not simply the widest that fits.
	//
	// Growing the bar adds ink without adding information, which mechanically
	// improves any slack-based score. Judging candidates by line-length spread
	// instead keeps that thumb off the scale: a wider bar is only taken when it
	// leaves the block at least as even. Ties favour the wider bar, so on roomy
	// terminals the bar still expands into space nothing else wants.
	let best: { cells: number; segs: Segment[]; packed: number[][]; spread: number } | null = null;
	for (let cells = minBar; cells <= maxBar; cells++) {
		const segs = build(cells);
		if (segs.length !== base.length) break;
		const texts = segs.map((s) => s.text);
		// On a very narrow terminal the line count is already saturated, so it
		// alone would not stop the loop once a segment overflows.
		if (cells > minBar && texts.some((t) => measure(t) > c.width)) break;
		let packed = flow(texts, c);
		if (packed.length > lineCount) break;
		const balanced = balance(texts, packed.length, c, opts.maxGap);
		if (balanced) packed = balanced;
		const s = spread(texts, packed, c);
		if (!best || s <= best.spread) best = { cells, segs, packed, spread: s };
	}
	if (!best) return { lines: [], barCells: minBar };

	const texts = best.segs.map((s) => s.text);
	return {
		lines: best.packed.map((line) => ({
			items: line.map((i) => best.segs[i]),
			gap: gapFor(texts, line, c, opts.maxGap),
		})),
		barCells: best.cells,
	};
}

/** Join one line's plain text, honouring its justification gap. */
export function lineText(line: LayoutLine, separator: string): string {
	return line.items.map((s) => s.text).join(separator + " ".repeat(line.gap));
}
