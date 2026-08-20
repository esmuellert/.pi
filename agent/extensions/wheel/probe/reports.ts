/**
 * How many mouse reports this terminal sends for one wheel notch.
 *
 * This is the measurement that decides the setting, and it has to be taken on
 * each terminal: the protocol carries no device type and no count, so the only
 * way to know what a terminal does is to ask it.
 *
 *   node --experimental-strip-types probe/reports.ts
 *
 * Run it in the terminal itself, not through anything that strips escapes.
 *
 * Reading it:
 *
 *   1 report per notch    the application decides the step -- this extension
 *                         is doing its job
 *   3 or more             the terminal already multiplies, and this extension
 *                         multiplies it again. Remove it.
 *
 * A trackpad swipe reports many times whatever the terminal does, because a
 * trackpad expresses speed through event count. If a swipe reports far more
 * than a notch, a multiplier will make swiping fly.
 */

const out = process.stdout;
const inp = process.stdin;

type Burst = { count: number; started: number; span: number };

const bursts: Burst[] = [];
let lastAt = 0;

/** A gap this long means the hand stopped, so the next event starts a burst. */
const BURST_GAP_MS = 200;

const show = () => {
	console.clear();
	console.log(`TERM=${process.env.TERM}  TERM_PROGRAM=${process.env.TERM_PROGRAM ?? "-"}  ${out.columns}x${out.rows}\n`);
	console.log("Scroll ONE notch of a wheel. Then try one short trackpad swipe.");
	console.log("q to quit.\n");
	for (const burst of bursts.slice(-12)) {
		console.log(
			`  ${String(burst.count).padStart(3)} reports  ${String(burst.span).padStart(4)}ms  ` +
				"\u2588".repeat(Math.min(60, burst.count)),
		);
	}
	if (bursts.length > 1) {
		const counts = bursts.map((b) => b.count).sort((a, b) => a - b);
		const median = counts[Math.floor(counts.length / 2)]!;
		console.log(`\n  median ${median} report(s) per burst`);
		console.log(
			median === 1
				? "  One report per notch: the application decides the step, so the setting is doing its job."
				: `  This terminal already multiplies (${median} per notch). The setting would multiply it again -- remove it.`,
		);
	}
};

inp.setRawMode?.(true);
inp.resume();
out.write("\u001b[?1000h\u001b[?1002h\u001b[?1006h");
show();

inp.on("data", (chunk: Buffer) => {
	const data = chunk.toString();
	if (data === "q" || data === "\u0003") {
		out.write("\u001b[?1006l\u001b[?1002l\u001b[?1000l");
		inp.setRawMode?.(false);
		console.log();
		process.exit(0);
	}
	// SGR mouse: ESC [ < button ; col ; row M -- 64 is wheel up, 65 wheel down.
	const wheels = [...data.matchAll(/\u001b\[<(6[45]);\d+;\d+M/g)];
	if (wheels.length === 0) return;
	const now = Date.now();
	if (now - lastAt > BURST_GAP_MS) bursts.push({ count: 0, started: now, span: 0 });
	const burst = bursts[bursts.length - 1]!;
	burst.count += wheels.length;
	burst.span = now - burst.started;
	lastAt = now;
	show();
});
