/**
 * The measurement itself, since every other performance test trusts it.
 *
 * Run: pnpm test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BUDGET_MS, FRAME_MS, frame, overBudget } from "./budget.ts";

/** Burn a known amount of time, without sleeping (which a frame cannot do). */
const spin = (millis: number) => () => {
	const until = performance.now() + millis;
	while (performance.now() < until) {
		/* a frame's work is synchronous */
	}
};

describe("measuring a frame", () => {
	it("reports roughly what the work costs", () => {
		const measured = frame(spin(5));
		assert.ok(measured >= 4.5, `5ms of work measured as ${measured.toFixed(1)}ms`);
		assert.ok(measured < 15, `5ms of work measured as ${measured.toFixed(1)}ms`);
	});

	it("ignores a single slow attempt, which is what machine noise looks like", () => {
		let attempt = 0;
		const measured = frame(() => {
			attempt += 1;
			// One attempt takes far longer, as if something else got the CPU.
			spin(attempt === 3 ? 40 : 2)();
		});
		assert.ok(measured < 10, `noise leaked into the reading: ${measured.toFixed(1)}ms`);
	});

	it("does not count the first draw, which pays for whatever is cached", () => {
		let drawn = 0;
		const measured = frame(() => {
			drawn += 1;
			// Only the very first draw is expensive, as a cold cache would be.
			spin(drawn === 1 ? 40 : 1)();
		});
		assert.ok(measured < 10, `the cold draw leaked into the reading: ${measured.toFixed(1)}ms`);
	});

	it("draws more than once, so a cache has something to be tested against", () => {
		let drawn = 0;
		frame(() => {
			drawn += 1;
		});
		assert.ok(drawn > 2, `drew ${drawn} times, too few to see past the first`);
	});
});

describe("the budget", () => {
	it("is a fraction of a frame, not a number someone picked", () => {
		assert.equal(FRAME_MS, 1000 / 60);
		assert.ok(BUDGET_MS < FRAME_MS, "an extension may not have the whole frame");
	});

	it("says nothing when the work fits", () => {
		assert.equal(overBudget(BUDGET_MS / 2), undefined);
	});

	it("reports the cost against the frame, not just against itself", () => {
		const message = overBudget(FRAME_MS * 2);
		assert.ok(message?.includes("200%"), `unhelpful failure message: ${message}`);
		assert.ok(message?.includes("keystroke"), "a failure should say what it means for the user");
	});
});
