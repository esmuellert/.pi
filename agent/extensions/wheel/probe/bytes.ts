/**
 * What one scrolled row costs on this link.
 *
 * Fullscreen mode repaints every visible row on every scroll, so the cost of a
 * scroll is the screen's worth of bytes. On the link this was written on that
 * turned out not to matter -- 100 MB/s, and the measurement fell below its own
 * noise -- but a phone on mobile data is a different link, and a bigger
 * terminal is a bigger screenful.
 *
 * Measure before assuming either way. The first version of this analysis
 * guessed a slow link and reached the opposite conclusion.
 *
 *   node --experimental-strip-types probe/bytes.ts
 *
 * It also draws the same scroll using a scroll region (DECSTBM), which lets
 * the terminal shift the rows itself so only the newly exposed row is painted.
 * pi does not do this. Whether it would be worth asking for depends on the
 * ratio below -- and on whether the second run looks right, which matters
 * more than the numbers.
 */

const out = process.stdout;
const W = out.columns ?? 80;
const H = out.rows ?? 24;
const TICKS = 40;

const line = (n: number) =>
	"\u001b[48;2;25;23;36m " +
	"\u001b[38;2;156;207;216m\u276f\u001b[39m " +
	"\u001b[38;2;224;222;244m\u001b[1m$\u001b[22m\u001b[39m " +
	"\u001b[38;2;49;116;143mgrep \u001b[39m" +
	"\u001b[38;2;235;188;186m-rn \u001b[39m" +
	`\u001b[38;2;246;193;119m"row ${n}"\u001b[39m` +
	" ".repeat(Math.max(0, W - 26)) +
	"\u001b[49m";

let wire = 0;
const write = (text: string) => {
	wire += Buffer.byteLength(text);
	out.write(text);
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What pi does: repaint every row that changed, which when scrolling is all of them. */
const repaintAll = () => {
	let buffer = "\u001b[?2026h";
	for (let row = 0; row < H - 1; row += 1) buffer += `\u001b[${row + 1};1H\u001b[2K${line(row)}`;
	write(buffer + "\u001b[?2026l");
};

/** What a scroll region does: the terminal shifts, only the new row is painted. */
const scrollRegion = (top: number) => {
	let buffer = "\u001b[?2026h";
	buffer += `\u001b[1;${H - 1}r\u001b[1S`;
	buffer += `\u001b[${H - 1};1H\u001b[2K${line(top + H - 2)}`;
	write(buffer + "\u001b[r\u001b[?2026l");
};

console.log(`TERM=${process.env.TERM}  ${W}x${H}`);
console.log(`scrolling ${TICKS} rows each way...\n`);
await sleep(300);

out.write("\u001b[?1049h\u001b[2J");

const measure = async (step: (tick: number) => void) => {
	wire = 0;
	repaintAll();
	await sleep(150);
	const started = performance.now();
	for (let tick = 1; tick <= TICKS; tick += 1) {
		step(tick);
		await sleep(16); // one frame, as a scroll burst would arrive
	}
	return { bytes: wire, blocked: performance.now() - started - TICKS * 16 };
};

const full = await measure(repaintAll);
const region = await measure(scrollRegion);

out.write("\u001b[?1049l");

const report = (name: string, r: { bytes: number; blocked: number }) =>
	`  ${name.padEnd(20)} ${String(r.bytes).padStart(9)} bytes  ${(r.bytes / TICKS).toFixed(0).padStart(6)}/row  ${r.blocked.toFixed(0).padStart(5)}ms blocked`;

console.log(report("repaint every row", full));
console.log(report("scroll region", region));
console.log(`\n  scroll region moves ${(full.bytes / region.bytes).toFixed(0)}x fewer bytes`);
console.log(`\n  Blocked time understates a slow link: write() returns once the bytes`);
console.log(`  are buffered, not once they arrive. The byte counts are the honest part.`);
console.log(`\n  Did the second run look right? Torn rows or leftovers matter more`);
console.log(`  than the ratio.`);
