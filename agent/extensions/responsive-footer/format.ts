/**
 * Pure formatting helpers. No I/O, no pi APIs — safe to unit test.
 */

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Compact token/byte counts: 999 -> "999", 12345 -> "12.3k", 1234567 -> "1.2M". */
export function formatCount(n: number): string {
	if (!Number.isFinite(n)) return "—";
	const v = Math.max(0, n);
	if (v < 1000) return `${Math.round(v)}`;
	if (v < 1_000_000) return `${(v / 1000).toFixed(1)}k`;
	if (v < 1_000_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
	return `${(v / 1_000_000_000).toFixed(1)}G`;
}

/** Fixed-width progress bar. */
export function progressBar(percent: number, cells: number): string {
	const c = Math.max(0, Math.floor(cells));
	if (c === 0) return "";
	const p = Number.isFinite(percent) ? clamp(percent, 0, 100) : 0;
	const filled = clamp(Math.round((p / 100) * c), 0, c);
	return "▓".repeat(filled) + "░".repeat(c - filled);
}

/**
 * Display width that accounts for East Asian wide characters.
 * The extension swaps in pi-tui's `visibleWidth` at render time (it also
 * strips ANSI); this default keeps the layout engine dependency-free.
 */
export function measureText(s: string): number {
	let w = 0;
	for (const ch of s) {
		const cp = ch.codePointAt(0) ?? 0;
		if (cp === 0x200b) continue;
		w +=
			(cp >= 0x1100 && cp <= 0x115f) ||
			(cp >= 0x2e80 && cp <= 0xa4cf) ||
			(cp >= 0xac00 && cp <= 0xd7a3) ||
			(cp >= 0xf900 && cp <= 0xfaff) ||
			(cp >= 0xfe30 && cp <= 0xfe6f) ||
			(cp >= 0xff00 && cp <= 0xff60) ||
			(cp >= 0xffe0 && cp <= 0xffe6)
				? 2
				: 1;
	}
	return w;
}

/** Replace a leading home directory with `~`. */
export function shortenHome(p: string, home: string): string {
	if (!home || !p.startsWith(home)) return p;
	const rest = p.slice(home.length);
	return rest.length === 0 ? "~" : `~${rest}`;
}
