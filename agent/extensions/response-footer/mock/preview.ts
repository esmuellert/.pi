/**
 * The line as pi would draw it: real theme, real widths, real numbers taken
 * from this session. Writes nothing.
 *
 *   node --experimental-strip-types mock/preview.ts
 *   W=120 THEME=catppuccin-mocha node --experimental-strip-types mock/preview.ts
 */
import { readFileSync } from "node:fs";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const DIST = `${entry.slice(0, entry.indexOf(`${sep}dist${sep}`))}/dist`;
const { initTheme } = await import("@earendil-works/pi-coding-agent");
initTheme(process.env.THEME ?? "rose-pine");
const { theme } = await import(`${DIST}/modes/interactive/theme/theme.js`);
const { visibleWidth } = await import("@earendil-works/pi-tui");
const { layout } = await import("../format.ts");
const { COLOUR } = await import("../index.ts");

/** Real replies from this session, so the figures are ones actually seen. */
const samples = JSON.parse(readFileSync(process.env.SAMPLES ?? "/tmp/rf-samples.json", "utf-8"));
const reply = "对，位置就是那儿。三个问题逐个答，最后一个要查代码。";

for (const width of [Number(process.env.W ?? 78), 53]) {
	console.log(`\n${theme.fg("muted", "─".repeat(width))}  ${width} columns\n`);
	for (const s of samples) {
		console.log(theme.fg("text", reply));
		const line = layout(s, width, visibleWidth);
		if (line) console.log(theme.fg(COLOUR, line));
		console.log();
	}
}
