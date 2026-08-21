/**
 * What the reminder looks like in each candidate colour.
 *
 * Run it in your own terminal; pi strips ANSI from command output.
 *
 *   node --experimental-strip-types ~/.pi/agent/extensions/behind/mock/colours.ts
 *   MOCK_THEME=catppuccin-mocha  MOCK_WIDTH=72
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const NAME = process.env.MOCK_THEME ?? "rose-pine";
const W = Number(process.env.MOCK_WIDTH ?? Math.min(72, process.stdout.columns ?? 72));
const theme = JSON.parse(readFileSync(join(homedir(), ".pi/agent/themes", `${NAME}.json`), "utf-8"));

const hex = (token: string) => theme.vars[theme.colors[token] ?? token] ?? theme.colors[token];
const paint = (token: string, text: string) => {
	const h = hex(token);
	const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
	return `\u001b[38;2;${r};${g};${b}m${text}\u001b[39m`;
};
const right = (text: string, painted: string) => " ".repeat(Math.max(0, W - text.length)) + painted;

const TEXT = ".pi is 3 commits behind main — git pull";
const SAY = ".pi is 3 commits behind main — ";
const DO = "git pull";

console.log(`\n  ${NAME} · ${W} columns · what sits above the editor\n`);
console.log(paint("dim", "  (a line of context above, so the weight can be compared)"));
console.log(paint("text", "  Ordinary reply text, for reference."));
console.log();

for (const token of ["dim", "muted", "text", "accent", "warning", "success"]) {
	console.log("  " + right(TEXT, paint(token, TEXT)) + "   " + paint("dim", token));
}
console.log();
console.log("  " + right(TEXT, paint("muted", SAY) + paint("accent", DO)) + "   " + paint("dim", "muted + accent"));
console.log("  " + right(TEXT, paint("dim", SAY) + paint("warning", DO)) + "   " + paint("dim", "dim + warning"));
console.log();
