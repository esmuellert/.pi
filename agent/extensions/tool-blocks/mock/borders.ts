/**
 * Framing a tool block with a border instead of a fill.
 *
 * Run in your own terminal; pi strips ANSI from command output.
 *
 *   node --experimental-strip-types mock/borders.ts
 *   MOCK_THEME=catppuccin-mocha  MOCK_WIDTH=64
 *
 * Nothing has to be stripped to do this. A tool definition can declare
 * `renderShell: "self"`, and pi then draws no background box at all -- it
 * pushes one blank line and hands the width to the component. That is how
 * `edit` already works, so the path is pi's own rather than a way around it.
 *
 * What is given up with the fill is the block's *extent*: a fill says where a
 * block ends without any character having to. A border has to say it, which is
 * what the variants below differ on.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const NAME = process.env.MOCK_THEME ?? "rose-pine";
const W = Number(process.env.MOCK_WIDTH ?? Math.min(64, process.stdout.columns ?? 64));
const theme = JSON.parse(readFileSync(join(homedir(), ".pi/agent/themes", `${NAME}.json`), "utf-8"));

const hex = (t: string) => theme.vars[theme.colors[t] ?? t] ?? theme.colors[t] ?? t;
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const FG = (t: string, s: string) => { const [r, g, b] = rgb(hex(t)); return `\u001b[38;2;${r};${g};${b}m${s}\u001b[39m`; };
const vis = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "").length;

const title = FG("toolTitle", "\u001b[1mgrep\u001b[22m") + " " + FG("accent", "/foo/") + FG("muted", " in ~");
const body = ["src/a.ts:12", "src/b.ts:40", "src/c.ts:7"].map((l) => FG("toolOutput", l));
const rule = (n: number) => "─".repeat(Math.max(0, n));

type V = { name: string; why: string; rows: string[] };
const V: V[] = [
	{
		name: "left rail",
		why: "one column. Says where the block starts and how far it runs, nothing else",
		rows: [FG("success", "│") + " " + title, ...body.map((l) => FG("borderMuted", "│") + " " + l)],
	},
	{
		name: "left rail, outcome only at the head",
		why: "the rail is furniture; only its first cell carries the outcome",
		rows: [FG("success", "┃") + " " + title, ...body.map((l) => FG("borderMuted", "│") + " " + l)],
	},
	{
		name: "bracket",
		why: "corners close the block without a full box; the extent is stated at both ends",
		rows: [
			FG("borderMuted", "┌") + " " + title,
			...body.map((l) => FG("borderMuted", "│") + " " + l),
			FG("borderMuted", "└" + rule(3)),
		],
	},
	{
		name: "rounded bracket",
		why: "the same with ╭ ╰",
		rows: [
			FG("borderMuted", "╭") + " " + title,
			...body.map((l) => FG("borderMuted", "│") + " " + l),
			FG("borderMuted", "╰" + rule(3)),
		],
	},
	{
		name: "full box",
		why: "encloses completely. Costs two rows and two columns, and every block gets a frame",
		rows: [
			FG("borderMuted", "╭" + rule(W - 2) + "╮"),
			FG("borderMuted", "│") + " " + title + " ".repeat(Math.max(0, W - 4 - vis(title))) + FG("borderMuted", " │"),
			...body.map((l) => FG("borderMuted", "│") + " " + l + " ".repeat(Math.max(0, W - 4 - vis(l))) + FG("borderMuted", " │")),
			FG("borderMuted", "╰" + rule(W - 2) + "╯"),
		],
	},
	{
		name: "header rule",
		why: "a line under the title only. The output is plain text, indented",
		rows: [title, FG("borderMuted", rule(Math.min(W, vis(title) + 4))), ...body.map((l) => "  " + l)],
	},
	{
		name: "header rule, full width",
		why: "the same rule carried across, which separates neighbouring blocks more firmly",
		rows: [title, FG("borderMuted", rule(W)), ...body.map((l) => "  " + l)],
	},
	{
		name: "rail plus closing tick",
		why: "a rail that ends in a foot, so a long block's end is visible without a full box",
		rows: [
			FG("success", "│") + " " + title,
			...body.map((l) => FG("borderMuted", "│") + " " + l),
			FG("borderMuted", "╵"),
		],
	},
];

console.log(`\n  ${NAME} · ${W} columns · marks omitted, framing only\n`);
for (const v of V) {
	console.log(FG("accent", `  ── ${v.name} ${rule(Math.max(0, W - v.name.length - 6))}`));
	console.log(FG("dim", `     ${v.why}`));
	console.log();
	for (const r of v.rows) console.log("  " + r);
	console.log();
}
