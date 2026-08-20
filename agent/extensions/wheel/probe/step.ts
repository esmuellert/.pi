/**
 * How far a wheel notch should move the screen, decided by hand.
 *
 * `reports.ts` says how many events arrive; this says what they should be
 * worth, which is a feel rather than a number. It reproduces what pi's
 * fullscreen mode does -- the same SGR parsing, the same full repaint -- with
 * the step as the only variable.
 *
 *   node --experimental-strip-types probe/step.ts
 *
 * Wheel up and down. 1-9 changes the step, q quits. 1 is pi's own behaviour.
 */

const out = process.stdout;
const inp = process.stdin;
const W = out.columns ?? 80;
const H = out.rows ?? 24;
const CONTENT = 4000;

let top = 0;
let step = 1;

/** A line the weight of a highlighted command, so the repaint costs what pi's does. */
const line = (n: number) =>
	"\u001b[48;2;25;23;36m " +
	"\u001b[38;2;156;207;216m\u276f\u001b[39m " +
	"\u001b[38;2;224;222;244m\u001b[1m$\u001b[22m\u001b[39m " +
	"\u001b[38;2;49;116;143mgrep \u001b[39m" +
	"\u001b[38;2;235;188;186m-rn \u001b[39m" +
	`\u001b[38;2;246;193;119m"line ${String(n).padStart(4, "0")}"\u001b[39m` +
	" ".repeat(Math.max(0, W - 26)) +
	"\u001b[49m";

const draw = () => {
	let buffer = "\u001b[?2026h";
	for (let row = 0; row < H - 1; row += 1) buffer += `\u001b[${row + 1};1H\u001b[2K${line(top + row)}`;
	const bar = ` step ${step} line${step > 1 ? "s" : ""} per report   ·   1-9 to change   ·   q to quit   ·   row ${top} `;
	buffer += `\u001b[${H};1H\u001b[2K\u001b[7m${bar}\u001b[27m`;
	out.write(buffer + "\u001b[?2026l");
};

inp.setRawMode?.(true);
inp.resume();
out.write("\u001b[?1049h\u001b[2J\u001b[?1000h\u001b[?1002h\u001b[?1006h\u001b[?25l");
draw();

inp.on("data", (chunk: Buffer) => {
	const data = chunk.toString();
	if (data === "q" || data === "\u0003") {
		out.write("\u001b[?1006l\u001b[?1002l\u001b[?1000l\u001b[?25h\u001b[?1049l");
		inp.setRawMode?.(false);
		process.exit(0);
	}
	if (/^[1-9]$/.test(data)) {
		step = Number(data);
		draw();
		return;
	}
	for (const match of data.matchAll(/\u001b\[<(\d+);\d+;\d+[Mm]/g)) {
		const button = Number(match[1]);
		if (button === 64) top = Math.max(0, top - step);
		else if (button === 65) top = Math.min(CONTENT - H, top + step);
		else continue;
		draw();
	}
});
