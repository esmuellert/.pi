/**
 * Ways of shaping a filled block, keeping the fill.
 *
 * Run in your own terminal; pi strips ANSI from command output.
 *
 *   node --experimental-strip-types mock/fills.ts
 *   MOCK_THEME=catppuccin-mocha  MOCK_WIDTH=64
 *
 * A cell is not the smallest unit available. Half blocks (U+2580 ▀, U+2584 ▄)
 * and quadrants (U+2596-259F) let an edge fall halfway through a row, so a
 * block can end without spending a whole blank line on saying so -- which is
 * what makes the shipped one look heavy: three of its seven rows are solid
 * colour carrying nothing.
 *
 * These need no page colour. Drawing a half block in the fill colour as
 * foreground, with no background set, leaves the other half showing whatever
 * the terminal's own background is.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const NAME = process.env.MOCK_THEME ?? "rose-pine";
const W = Number(process.env.MOCK_WIDTH ?? Math.min(64, process.stdout.columns ?? 64));
const theme = JSON.parse(readFileSync(join(homedir(), ".pi/agent/themes", `${NAME}.json`), "utf-8"));

const hex = (token: string) => theme.vars[theme.colors[token] ?? token] ?? theme.colors[token] ?? token;
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const FG = (t: string, s: string) => { const [r, g, b] = rgb(hex(t)); return `\u001b[38;2;${r};${g};${b}m${s}\u001b[39m`; };
const BG = (t: string, s: string) => { const [r, g, b] = rgb(hex(t)); return `\u001b[48;2;${r};${g};${b}m${s}\u001b[49m`; };
const vis = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "").length;
const fit = (s: string, w: number) => s + " ".repeat(Math.max(0, w - vis(s)));

const FILL = "toolSuccessBg";
const title = FG("success", "✱") + " " + FG("toolTitle", "\u001b[1mgrep\u001b[22m") + " " + FG("accent", "/foo/") + FG("muted", " in ~");
const body = ["src/a.ts:12", "src/b.ts:40", "src/c.ts:7"].map((l) => FG("toolOutput", l));

/** A full row of fill with `text` inset two columns. */
const row = (text = "") => BG(FILL, fit("  " + text, W));

type Shape = { name: string; why: string; rows: string[] };
const SHAPES: Shape[] = [
	{
		name: "what pi ships",
		why: "a blank filled row above and below — three of seven rows are solid colour saying nothing",
		rows: [row(), row(title), row(), ...body.map(row), row()],
	},
	{
		name: "half-block edges",
		why: "▄ and ▀ end the block halfway through a row instead of spending a whole one",
		rows: [FG(FILL, "▄".repeat(W)), row(title), ...body.map(row), FG(FILL, "▀".repeat(W))],
	},
	{
		name: "half-block edges, breathing room kept",
		why: "the same, with the blank row that separates the title from the output",
		rows: [FG(FILL, "▄".repeat(W)), row(title), row(), ...body.map(row), FG(FILL, "▀".repeat(W))],
	},
	{
		name: "chamfered corners",
		why: "quadrants cut the four corners, so the rectangle stops looking stamped on",
		rows: [
			FG(FILL, "▗" + "▄".repeat(W - 2) + "▖"),
			row(title), ...body.map(row),
			FG(FILL, "▝" + "▀".repeat(W - 2) + "▘"),
		],
	},
	{
		name: "inset, chamfered",
		why: "two columns of page on each side, so the block sits in the page rather than covering it",
		rows: [
			"  " + FG(FILL, "▗" + "▄".repeat(W - 6) + "▖"),
			"  " + BG(FILL, fit("  " + title, W - 4)),
			...body.map((l) => "  " + BG(FILL, fit("  " + l, W - 4))),
			"  " + FG(FILL, "▝" + "▀".repeat(W - 6) + "▘"),
		],
	},
	{
		name: "accent stripe inside the fill",
		why: "the outcome colour as a bar at the left edge, inside the block rather than beside it",
		rows: [
			FG(FILL, "▄".repeat(W)),
			BG(FILL, FG("success", "▌") + fit(" " + title, W - 1)),
			...body.map((l) => BG(FILL, FG("success", "▌") + fit(" " + l, W - 1))),
			FG(FILL, "▀".repeat(W)),
		],
	},
	{
		name: "header darker than body",
		why: "two tones instead of one, so the title reads as a header rather than a first line",
		rows: [
			FG("selectedBg", "▄".repeat(W)),
			BG("selectedBg", fit("  " + title, W)),
			...body.map((l) => BG(FILL, fit("  " + l, W))),
			FG(FILL, "▀".repeat(W)),
		],
	},
];

console.log(`\n  ${NAME} · ${W} columns\n`);
for (const s of SHAPES) {
	console.log(FG("accent", `  ── ${s.name} ${"─".repeat(Math.max(0, W - s.name.length - 6))}`));
	console.log(FG("dim", `     ${s.why}`));
	console.log();
	for (const r of s.rows) console.log("  " + r);
	console.log();
}
