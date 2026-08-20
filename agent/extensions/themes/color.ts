// Colour maths for theme generation.
//
// pi's TUI has no alpha, so the one derived colour these themes need — a tool
// block tinted by its state — has to be composited down to an opaque value
// here. The alpha is not invented: both upstream projects publish the same
// figure for exactly this purpose in their own editor ports.
//
//   rose-pine   diffEditor.insertedLineBackground = #9ccfd826  (0x26/255)
//   catppuccin  diffEditor.insertedLineBackground = opacity(green, 0.15)
//
// https://github.com/rose-pine/vscode/blob/main/themes/rose-pine-color-theme.json
// https://github.com/catppuccin/vscode/blob/main/packages/catppuccin-vsc/src/theme/uiColors.ts

export type Rgb = readonly [number, number, number];

const HEX = /^#[0-9a-fA-F]{6}$/;

export function parse(hex: string): Rgb {
	if (!HEX.test(hex)) throw new Error(`not a 6 digit hex colour: ${hex}`);
	const n = Number.parseInt(hex.slice(1), 16);
	return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function format([r, g, b]: Rgb): string {
	const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
	return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Composite `tint` at `alpha` over the opaque `base`, the way a GUI would. */
export function composite(base: string, tint: string, alpha: number): string {
	if (!(alpha >= 0 && alpha <= 1)) throw new Error(`alpha out of range: ${alpha}`);
	const b = parse(base);
	const t = parse(tint);
	return format([0, 1, 2].map((i) => b[i]! + (t[i]! - b[i]!) * alpha) as unknown as Rgb);
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
	const channel = (v: number) => {
		const s = v / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	const [r, g, b] = parse(hex);
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
	return (hi + 0.05) / (lo + 0.05);
}

/**
 * How different two colours look, regardless of which is lighter.
 *
 * Contrast ratio is the wrong tool for telling two backgrounds apart: it only
 * compares luminance, so a red-tinted and a blue-tinted surface of the same
 * lightness score 1.0 while being obviously different on screen. This is the
 * redmean approximation of perceptual distance, roughly 0 to 765.
 *
 * https://www.compuphase.com/cmetric.htm
 */
export function difference(a: string, b: string): number {
	const [ar, ag, ab] = parse(a);
	const [br, bg, bb] = parse(b);
	const mean = (ar + br) / 2;
	const [dr, dg, db] = [ar - br, ag - bg, ab - bb];
	return Math.sqrt((2 + mean / 256) * dr ** 2 + 4 * dg ** 2 + (2 + (255 - mean) / 256) * db ** 2);
}
