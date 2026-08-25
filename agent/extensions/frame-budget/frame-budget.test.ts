/**
 * The measurement itself, since every other performance test trusts it.
 *
 * Run: pnpm test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BUDGET_MS, FRAME_MS, frame, growsTooFast, growth, overBudget, speedup, tooSlow } from "./budget.ts";

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

describe("ratios, which the machine cancels out of", () => {
	it("reports how much cheaper repeating work is", () => {
		// The regression this file exists for was a cache that stopped being
		// used. A budget in milliseconds catches it and also fails on a slower
		// machine; a ratio catches it anywhere.
		let calls = 0;
		const ratio = speedup(() => { for (let i = 0; i < 2_000_000; i += 1) calls += 1; }, () => { calls += 1; });
		assert.ok(ratio > 100, `expected a large speedup, got ${ratio}`);
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
		const spin = (n: number) => () => { let t = 0; for (let i = 0; i < n; i += 1) t += i; return t; };
		const ratio = growth(spin(2_000_000), spin(8_000_000));
		// Four times the work, linearly: generous bounds, since this measures a
		// real machine and the point is the shape, not the number.
		assert.ok(ratio > 2 && ratio < 8, `expected roughly 4x, got ${ratio}`);
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
