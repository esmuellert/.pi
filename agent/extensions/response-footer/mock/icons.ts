/**
 * Candidate glyphs for the tool count, drawn in a real line.
 *
 *   node --experimental-strip-types mock/icons.ts
 *
 * pi strips escape codes from command output, so this has to be run in your own
 * terminal to see the glyphs at all.
 */
import { sep } from "node:path";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const DIST = `${entry.slice(0, entry.indexOf(`${sep}dist${sep}`))}/dist`;
const { initTheme } = await import("@earendil-works/pi-coding-agent");
initTheme(process.env.THEME ?? "rose-pine");
const { theme } = await import(`${DIST}/modes/interactive/theme/theme.js`);
const { visibleWidth } = await import("@earendil-works/pi-tui");

const CACHE = "\uF1C0";
const candidates: [string, string][] = [
	["\uf0ad", "wrench"],
	["\uf7d9", "tools"],
	["\uf013", "cog"],
	["\uf085", "cogs"],
	["\uf120", "terminal"],
	["\uf0e7", "bolt"],
	["\uf1b3", "cubes"],
	["\uf49e", "toolbox"],
	["", "（不用图标）"],
];

const W = Number(process.env.W ?? 78);
console.log(theme.fg("muted", `\n${"─".repeat(W)}  ${W} columns\n`));
for (const [glyph, name] of candidates) {
	const tools = glyph ? `${glyph} 36` : "36 tools";
	const line = `${tools} 4m37s $8.08 ${CACHE} 100% ↑15.1M ↓15k`;
	const pad = " ".repeat(Math.max(0, W - visibleWidth(line) - 18));
	console.log(pad + theme.fg("dim", line) + theme.fg("muted", `   ${name}`));
}
console.log();
