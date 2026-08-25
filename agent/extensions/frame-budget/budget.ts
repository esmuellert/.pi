/**
 * What a still frame may cost, and how to measure it without flaking.
 *
 * Named budget.ts rather than index.ts on purpose. pi treats any directory
 * under extensions/ that holds an index.ts as an extension and tries to load a
 * factory from it, and a package.json declaring no extensions does not opt out
 * -- the loader falls through to index.ts when the list is empty. A helper
 * library living here must therefore not have one.
 *
 * Every extension that draws is asked to draw again on every frame, so
 * anything it does per render is done once per keystroke. The failure this
 * guards against is not slow code but code whose cost grows with the session:
 * a bash highlighter that re-tokenised every block turned a still frame into
 * two thirds of a second, and it read as the session having grown too large.
 *
 * Scaling alone would not have caught it. Both the broken and the fixed
 * version cost time proportional to the number of blocks on screen; what
 * changed was the constant, by a factor of six hundred. So the assertion has
 * to be an absolute budget, which makes it machine-dependent — see BUDGET.
 */

/**
 * A frame at 60fps. Not a target, a ceiling: a redraw that takes longer than
 * this cannot keep up with a held-down key.
 */
export const FRAME_MS = 1000 / 60;

/**
 * The share of a frame an extension may spend before it is the reason a
 * keystroke feels slow.
 *
 * pi's own rendering needs most of the frame, so extensions get a quarter
 * between them. Measured on the machine this was written on, the two that draw
 * use a twelfth of that between them, which is the headroom a slower machine
 * or a loaded one needs before this starts crying wolf.
 */
export const BUDGET_MS = FRAME_MS / 4;

/** How many times to draw before believing the number. */
const ATTEMPTS = 7;

/**
 * The cost of one still frame, in milliseconds.
 *
 * The minimum of several attempts rather than the mean: noise only ever adds
 * time, so the smallest reading is the closest to what the work actually
 * costs. A mean would make the test fail when something else on the machine
 * happened to run.
 *
 * The first attempt is discarded, since it pays for whatever the code caches
 * on first use, and a still frame by definition is not the first one.
 * `now` is a seam for this function's own tests. What it has to get right --
 * discard the first draw, keep the smallest of the rest -- is arithmetic over a
 * sequence of readings, and a shared machine cannot be asked to produce a known
 * sequence: a CI runner descheduled a five-millisecond busy-wait into twelve.
 */
export function frame(draw: () => void, now: () => number = performance.now.bind(performance)): number {
	draw();
	let best = Infinity;
	for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
		const started = now();
		draw();
		best = Math.min(best, now() - started);
	}
	return best;
}

/**
 * How much cheaper repeating work is than doing it the first time.
 *
 * The regression this file exists for was a cache that stopped being used: the
 * same redraw went from remembering its tokens to recomputing them, six hundred
 * times the cost. Both versions scaled the same way with the number of blocks,
 * so only the constant moved -- which is why the first assertion written here
 * was an absolute budget.
 *
 * An absolute budget is a claim about the machine as much as about the code, and
 * it fails on a slower one for no reason anyone can act on. A ratio is the same
 * claim without that: the machine cancels out, because both halves are measured
 * on it. A cache that has stopped working cannot be six hundred times cheaper on
 * any machine, however fast or loaded.
 *
 * `cold` must genuinely do the work again -- forget the cache, use a new width,
 * whatever makes it real -- or the ratio measures nothing.
 *
 * `measure` exists so this function's own tests can hand it known numbers.
 * Timing the timer on a shared machine is not reliable: the first version of
 * those tests busy-waited for 5ms and 20ms, and a CI runner descheduled the
 * short one into taking twelve, which reads as a ratio of 1.6 rather than 4.
 */
export function speedup(cold: () => void, warm: () => void, measure = frame): number {
	const first = measure(cold);
	const again = measure(warm);
	return again === 0 ? Infinity : first / again;
}

/**
 * How the cost grows when the work does.
 *
 * The other machine-independent question. A layout that is linear in the session
 * stays usable however long the session gets; one that is quadratic is fine in
 * every test and unusable by evening. The ratio of the two measurements answers
 * that without either of them being a claim about the machine.
 *
 * `measure` is a seam for this function's own tests, as in speedup.
 */
export function growth(small: () => void, large: () => void, measure = frame): number {
	const a = measure(small);
	const b = measure(large);
	return a === 0 ? Infinity : b / a;
}

/** The message a superlinear growth should carry. */
export function growsTooFast(ratio: number, work: number, allowed: number): string | undefined {
	if (ratio <= allowed) return undefined;
	return (
		`${work}x the work cost ${ratio.toFixed(1)}x the time, wanted at most ${allowed}x. ` +
		`Something here is superlinear, which is fine in a test and unusable in a long session.`
	);
}

/** The message a too-small speedup should carry. */
export function tooSlow(ratio: number, wanted: number): string | undefined {
	if (ratio >= wanted) return undefined;
	return (
		`repeating the work was only ${ratio.toFixed(1)}x cheaper than doing it, wanted ${wanted}x. ` +
		`Something that should be remembered between frames is being recomputed, ` +
		`which is what a keystroke waits for.`
	);
}

/** The message a failure should carry: the cost, the budget, and the frame it sits in. */
export function overBudget(cost: number, budget = BUDGET_MS): string | undefined {
	if (cost <= budget) return undefined;
	return (
		`a still frame cost ${cost.toFixed(1)}ms, over the ${budget.toFixed(1)}ms budget ` +
		`(${((cost / FRAME_MS) * 100).toFixed(0)}% of a ${FRAME_MS.toFixed(1)}ms frame). ` +
		`This is what a keystroke waits for.`
	);
}
