/**
 * Ways of setting a tool block apart from the page.
 *
 * Run in your own terminal; pi strips ANSI from command output.
 *
 *   node --experimental-strip-types mock/frames.ts
 *   MOCK_THEME=catppuccin-mocha  MOCK_WIDTH=72
 *
 * The filled rectangle pi ships is one of several. pi's own markdown does not
 * use it: a quote gets a `│` rail and a code block a `┌─` corner, both drawn in
 * a border colour with no fill. So the alternatives here are not inventions --
 * they are what the same program already does elsewhere.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const NAME = process.env.MOCK_THEME ?? "rose-pine";
const W = Number(process.env.MOCK_WIDTH ?? Math.min(72, process.stdout.columns ?? 72));
const theme = JSON.parse(readFileSync(join(homedir(), ".pi/agent/themes", `${NAME}.json`), "utf-8"));

const hex = (token: string) => {
	const raw = theme.colors[token] ?? token;
	return theme.vars[raw] ?? raw;
};
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const fg = (token: string, text: string) => {
	const [r, g, b] = rgb(hex(token));
	return `\u001b[38;2;${r};${g};${b}m${text}\u001b[39m`;
};
const bg = (token: string, text: string) => {
	const [r, g, b] = rgb(hex(token));
	return `\u001b[48;2;${r};${g};${b}m${text}\u001b[49m`;
};
const pad = (text: string, width: number) => text + " ".repeat(Math.max(0, width - visible(text)));
const visible = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "").length;

/** The content of a block, without any framing. */
const title = fg("success", "✱") + " " + fg("toolTitle", "\u001b[1mgrep\u001b[22m") + " " + fg("accent", "/foo/") + fg("muted", " in ~");
const body = [fg("toolOutput", "src/a.ts:12"), fg("toolOutput", "src/b.ts:40"), fg("toolOutput", "src/c.ts:7")];

type Frame = { name: string; why: string; lines: () => string[] };

const FRAMES: Frame[] = [
	{
		name: "filled — what pi ships",
		why: "one flat rectangle, full width, a blank row above and below",
		lines: () => [
			bg("toolSuccessBg", pad("", W)),
			bg("toolSuccessBg", pad("  " + title, W)),
			bg("toolSuccessBg", pad("", W)),
			...body.map((l) => bg("toolSuccessBg", pad("  " + l, W))),
			bg("toolSuccessBg", pad("", W)),
		],
	},
	{
		name: "rail",
		why: "what pi's own markdown gives a quote: a vertical line, no fill",
		lines: () => [
			fg("borderMuted", "│") + "  " + title,
			...body.map((l) => fg("borderMuted", "│") + "  " + l),
		],
	},
	{
		name: "rail, accented head",
		why: "the rail says where the block is; its colour says how the call went",
		lines: () => [
			fg("success", "┃") + "  " + title,
			...body.map((l) => fg("borderMuted", "│") + "  " + l),
		],
	},
	{
		name: "fill on the title only",
		why: "the header is the part worth finding; the output is just text",
		lines: () => [
			bg("toolSuccessBg", pad("  " + title, W)),
			...body.map((l) => "  " + l),
		],
	},
	{
		name: "corner",
		why: "what pi's own markdown gives a code block",
		lines: () => [
			fg("borderMuted", "┌─ ") + title,
			...body.map((l) => fg("borderMuted", "│  ") + l),
			fg("borderMuted", "└" + "─".repeat(Math.min(20, W - 2))),
		],
	},
	{
		name: "rounded corner",
		why: "the same, with ╭╰ instead of ┌└",
		lines: () => [
			fg("borderMuted", "╭─ ") + title,
			...body.map((l) => fg("borderMuted", "│  ") + l),
			fg("borderMuted", "╰" + "─".repeat(Math.min(20, W - 2))),
		],
	},
	{
		name: "rule above",
		why: "no vertical furniture at all; a line separates, nothing encloses",
		lines: () => [
			fg("borderMuted", "─".repeat(3)) + " " + title,
			...body.map((l) => "    " + l),
		],
	},
	{
		name: "half-block rail",
		why: "▏ is a quarter cell, thinner than │ and closer to a hairline",
		lines: () => [
			fg("success", "▏") + "  " + title,
			...body.map((l) => fg("borderMuted", "▏") + "  " + l),
		],
	},
];

console.log(`\n  ${NAME} · ${W} columns\n`);
for (const frame of FRAMES) {
	console.log(fg("accent", `  ── ${frame.name} ${"─".repeat(Math.max(0, W - frame.name.length - 6))}`));
	console.log(fg("dim", `     ${frame.why}`));
	console.log();
	for (const line of frame.lines()) console.log("  " + line);
	console.log();
}
