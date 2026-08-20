/**
 * What a reply looks like under different choices for the heading colour.
 *
 * Run it in your own terminal; pi strips ANSI from command output.
 *
 *   cd ~/.pi/agent/extensions/themes
 *   node --experimental-strip-types mock/heading.ts
 *
 *   MOCK_THEME=rose-pine-moon
 *   MOCK_WIDTH=80
 *
 * Headings already arrive bold, and level-one underlined, so the colour is the
 * second signal rather than the only one. That is what makes "no accent at
 * all" a real option here.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const NAME = process.env.MOCK_THEME ?? "rose-pine";
const WIDTH = Number(process.env.MOCK_WIDTH ?? process.stdout.columns ?? 80);
const theme = JSON.parse(readFileSync(join(homedir(), ".pi/agent/themes", `${NAME}.json`), "utf-8"));

const hex = (token: string): string => {
	const raw = theme.colors[token] ?? token;
	return theme.vars[raw] ?? raw;
};
const paint = (value: string, text: string) => {
	const h = value.startsWith("#") ? value : hex(value);
	const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
	return `\u001b[38;2;${r};${g};${b}m${text}\u001b[39m`;
};
const bold = (text: string) => `\u001b[1m${text}\u001b[22m`;
const underline = (text: string) => `\u001b[4m${text}\u001b[24m`;

/** A reply with the things that actually collide: headings, inline code, numbers. */
const reply = (heading: string) => {
	const H1 = (t: string) => paint(heading, bold(underline(`# ${t}`)));
	const H2 = (t: string) => paint(heading, bold(`## ${t}`));
	const body = (t: string) => paint("text", t);
	const code = (t: string) => paint("mdCode", t);
	const bullet = paint("mdListBullet", "-");
	const num = (t: string) => paint("syntaxNumber", t);
	const str = (t: string) => paint("syntaxString", t);
	const kw = (t: string) => paint("syntaxKeyword", t);
	const comment = (t: string) => paint("syntaxComment", t);
	return [
		H1("Scroll anchoring"),
		"",
		body("The viewport keeps its ") + code("scrollTop") + body(" when the content grows, so"),
		body("what you were reading moves. ") + code("updateLayout") + body(" only clamps."),
		"",
		H2("Where it happens"),
		"",
		`${bullet} ` + code("scroll-view.ts") + body(" line ") + num("214"),
		`${bullet} ` + body("only in ") + code("fullscreen") + body(" mode"),
		"",
		H2("The fix"),
		"",
		paint("mdCodeBlockBorder", "┌─"),
		paint("mdCodeBlockBorder", "│ ") + kw("const") + paint("mdCodeBlock", " anchor = lines[") + num("0") + paint("mdCodeBlock", "];"),
		paint("mdCodeBlockBorder", "│ ") + comment("// put it back afterwards"),
		paint("mdCodeBlockBorder", "│ ") + paint("mdCodeBlock", "scrollTo(find(anchor, ") + str('"after"') + paint("mdCodeBlock", "));"),
		paint("mdCodeBlockBorder", "└─"),
	];
};

const OPTIONS: [string, string, string][] = [
	["today", hex("mdHeading"), "rose — shares with mdCode and syntaxNumber"],
	["body text", hex("text"), "no hue at all; bold and underline carry it"],
	["signature", hex("accent"), "the colour the palette is known by"],
	["warning", hex("warning"), "what it was before, for comparison"],
];

console.log(`\n  ${NAME} · ${WIDTH} columns\n`);
for (const [label, colour, why] of OPTIONS) {
	console.log(paint("accent", `${"━".repeat(4)} ${label} — ${colour} ${"━".repeat(Math.max(0, WIDTH - label.length - 16))}`));
	console.log(paint("dim", `  ${why}\n`));
	for (const line of reply(colour)) console.log("  " + line);
	console.log();
}
