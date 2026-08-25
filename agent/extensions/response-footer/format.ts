/**
 * The line itself: which parts, in what order, and what to drop when narrow.
 *
 * Parts are ordered by how often they tell you something. Tools and time are
 * what a reader scans for; cost answers "why was that expensive"; the cache
 * rate answers it more precisely, and tokens are the raw figure behind both.
 * When the width runs out the tail goes first, so the same two facts stay in
 * the same place at every width rather than the line rearranging itself.
 */

import type { Stats } from "./stats.ts";

/**
 * Two spaces, the same as the statusline uses.
 *
 * A dot between fields spends a character saying what the gap already says, and
 * made the line read as a sentence rather than as a row of figures. One space is
 * not enough: several parts contain a space of their own, so the eye has nothing
 * to group by, and the line is short enough that the four columns saved buy
 * nothing -- even the worst reply here fits a 53-column terminal either way.
 *
 * The line looks tighter on a wide terminal than on a narrow one, and that is
 * not the separator: the line is the same length in both, so on 78 columns it
 * is a small cluster against 39 columns of empty space, and on 53 it nearly
 * spans the width. Varying the separator by width would fix the look and break
 * the rule that resizing stays continuous.
 */
export const SEPARATOR = "  ";

/**
 * The glyphs, both Nerd Font.
 *
 * `cache` is the one the statusline already uses for the same number. `tools` is
 * a wrench rather than a cog: a cog reads as settings in most interfaces. Per
 * tool icons exist in tool-blocks, but this counts tools of every kind, so it
 * needs the category rather than any one member of it.
 *
 * A font without them draws a box, which still measures one column, so the line
 * stays aligned either way.
 */
export const ICON = {
	tools: "\uF0AD",
	cache: "\uF1C0",
} as const;

/** Seconds, then minutes, then hours -- never more than three characters of number. */
export function duration(ms: number): string {
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s}s`;
	if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
	return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

/** Token counts, at the precision the number deserves. */
export function tokens(n: number): string {
	if (n < 1000) return String(n);
	if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
	return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * Money, at the precision the amount deserves.
 *
 * Most replies here cost under a dollar, so cents alone would print $0.00 for
 * half of them. Trailing zeros are dropped: $0.500 reads as more precision than
 * the number has.
 */
export function money(cost: number): string {
	const digits = cost >= 1 ? 2 : 3;
	return `$${Number(cost.toFixed(digits))}`;
}

/** Every part the line could carry, most useful first. */
export function parts(s: Stats): string[] {
	const out: string[] = [];
	if (s.tools > 0) out.push(`${ICON.tools} ${s.tools}`);
	out.push(duration(s.ms));
	if (s.cost > 0) out.push(money(s.cost));
	if (s.cacheHit !== null) out.push(`${ICON.cache} ${Math.round(s.cacheHit * 100)}%`);
	if (s.tokensIn > 0 || s.tokensOut > 0) out.push(`↑${tokens(s.tokensIn)} ↓${tokens(s.tokensOut)}`);
	return out;
}

/**
 * As much of the line as fits, dropping from the end.
 *
 * Nothing is abbreviated to make it fit: a shortened figure is a figure the
 * reader has to decode. A part either appears whole or not at all.
 */
export function fit(all: string[], width: number, measure: (s: string) => number): string {
	for (let take = all.length; take > 0; take -= 1) {
		const line = all.slice(0, take).join(SEPARATOR);
		if (measure(line) <= width) return line;
	}
	return "";
}

/** The finished line, right-aligned, or empty when there is no room at all. */
export function layout(s: Stats, width: number, measure: (t: string) => number): string {
	const line = fit(parts(s), width, measure);
	if (!line) return "";
	return " ".repeat(Math.max(0, width - measure(line))) + line;
}
