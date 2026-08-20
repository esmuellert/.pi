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
 */
export function frame(draw: () => void): number {
	draw();
	let best = Infinity;
	for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
		const started = performance.now();
		draw();
		best = Math.min(best, performance.now() - started);
	}
	return best;
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
