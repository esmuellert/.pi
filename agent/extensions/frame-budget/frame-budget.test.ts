/**
 * The measurement itself, since every other performance test trusts it.
 *
 * Run: pnpm test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BUDGET_MS, FRAME_MS, frame, growsTooFast, growth, overBudget, speedup, tooSlow } from "./budget.ts";

const noop = () => {};

/**
 * A clock that reports the given costs, one per draw.
 *
 * Wall time is not available to assert on: a shared machine descheduled a
 * five-millisecond busy-wait into twelve, which is larger than the difference
 * any of these tests is about. What frame() has to get right is arithmetic over
 * a sequence of readings, so the readings are given.
 */
const clock = (...costs: number[]) => {
	let at = 0;
	let draw = 0;
	return () => {
		// Called twice per attempt: before the draw and after it.
		const cost = costs[draw]! ?? 0;
		if (at % 2 === 1) draw += 1;
		at += 1;
		return at % 2 === 1 ? 1000 : 1000 + cost;
	};
};

describe("measuring a frame", () => {
	it("reports what the work costs", () => {
		assert.equal(frame(noop, clock(5, 5, 5, 5, 5, 5, 5)), 5);
	});

	it("ignores a single slow attempt, which is what machine noise looks like", () => {
		// One attempt takes far longer, as if something else got the CPU.
		assert.equal(frame(noop, clock(2, 2, 40, 2, 2, 2, 2)), 2);
	});

	it("does not count the first draw, which pays for whatever is cached", () => {
		// Stated as the thing itself: one more draw happens than is timed. A
		// cost sequence cannot show this, because the warm-up never reaches the
		// clock -- which is the property.
		let draws = 0;
		let readings = 0;
		frame(
			() => {
				draws += 1;
			},
			() => {
				readings += 1;
				return readings;
			},
		);
		assert.equal(readings % 2, 0, "the clock is read before and after each timed draw");
		assert.equal(draws - readings / 2, 1, "exactly one draw goes untimed");
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

describe("ratios, which the machine cancels out of", () => {
	const noop = () => {};

	// Handed known readings rather than a clock. frame() is what turns work into
	// a number, and it has its own tests above; what these add is the division
	// and what it does at zero, which a shared CI machine cannot be asked about.
	const readings = (...values: number[]) => {
		let next = 0;
		return () => values[next++]!;
	};

	it("reports how much cheaper repeating work is", () => {
		// The regression this file exists for was a cache that stopped being
		// used. A budget in milliseconds catches it and also fails on a slower
		// machine; a ratio catches it anywhere.
		assert.equal(speedup(noop, noop, readings(120, 0.2)), 600);
	});

	it("calls a free repeat infinitely cheaper, rather than dividing by zero", () => {
		assert.equal(speedup(noop, noop, readings(120, 0)), Infinity);
	});

	it("says nothing when repeating is cheap enough", () => {
		assert.equal(tooSlow(500, 100), undefined);
	});

	it("names both numbers when it is not", () => {
		const message = tooSlow(3, 100);
		assert.match(message ?? "", /3\.0x/);
		assert.match(message ?? "", /100x/);
		assert.match(message ?? "", /recomputed/);
	});

	it("reports how cost grows with the work", () => {
		assert.equal(growth(noop, noop, readings(5, 20)), 4);
	});

	it("says nothing when growth is linear", () => {
		assert.equal(growsTooFast(4.2, 4, 8), undefined);
	});

	it("names the shape when it is not", () => {
		const message = growsTooFast(16, 4, 8);
		assert.match(message ?? "", /4x the work cost 16\.0x/);
		assert.match(message ?? "", /superlinear/);
	});
});
