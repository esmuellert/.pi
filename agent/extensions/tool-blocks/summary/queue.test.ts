import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { forgetQueue, LIMIT, pressure, through } from "./queue.ts";

afterEach(forgetQueue);

describe("how sentences are asked for", () => {
	it("serves the last one asked for first, including the first five", async () => {
		// A transcript renders top to bottom in one synchronous pass, so the
		// oldest block asks first. Admitting each caller as it arrives hands the
		// five open slots to the five oldest -- the ones scrolled off the top --
		// before the block being looked at has asked at all.
		const order: number[] = [];
		const all = Array.from({ length: 20 }, (_, at) =>
			through(async () => {
				order.push(at);
				await new Promise((settle) => setTimeout(settle, 2));
			}),
		);
		await Promise.all(all);
		assert.equal(order[0], 19, "the last block asked for was not served first");
		assert.deepEqual(order.slice(0, LIMIT), [19, 18, 17, 16, 15]);
	});

	it("never has more than the limit in flight", async () => {
		let live = 0;
		let peak = 0;
		await Promise.all(
			Array.from({ length: LIMIT * 6 }, () =>
				through(async () => {
					live += 1;
					peak = Math.max(peak, live);
					await new Promise((settle) => setTimeout(settle, 5));
					live -= 1;
				}),
			),
		);
		assert.equal(peak, LIMIT);
	});

	it("runs all of them, not the first few", async () => {
		// A cap that dropped the rest would leave those blocks blank forever.
		const ran: number[] = [];
		await Promise.all(Array.from({ length: 40 }, (_, at) => through(async () => { ran.push(at); })));
		assert.equal(ran.length, 40);
		assert.deepEqual([...ran].sort((a, b) => a - b), Array.from({ length: 40 }, (_, at) => at));
	});

	it("puts a block that finishes later ahead of the backlog", async () => {
		// It is the one being watched, for the same reason the newest goes first.
		const order: string[] = [];
		const backlog = Array.from({ length: 20 }, (_, at) =>
			through(async () => {
				order.push(`old-${at}`);
				await new Promise((settle) => setTimeout(settle, 5));
			}),
		);
		await new Promise((settle) => setTimeout(settle, 6));
		const fresh = through(async () => { order.push("new"); });
		await Promise.all([...backlog, fresh]);
		const arrived = order.indexOf("new");
		assert.ok(arrived < order.length - 1, "the new block waited for the whole backlog");
	});

	it("gives the slot back when a request throws", async () => {
		// Otherwise one refusal narrows the gate for the rest of the session.
		await Promise.allSettled(
			Array.from({ length: LIMIT }, () => through(async () => { throw new Error("refused"); })),
		);
		assert.deepEqual(pressure(), { live: 0, waiting: 0 });
		await through(async () => {});
	});

	it("reports what a caller was told", async () => {
		assert.equal(await through(async () => "a note"), "a note");
		await assert.rejects(through(async () => { throw new Error("refused"); }), /refused/);
	});

	it("does not hold anything back while there is room", async () => {
		// A normal turn runs one to three tools; the gate must be invisible.
		// Asserted as "they all ran together", not as milliseconds -- a timing
		// bound only measures the machine. Everything is on the stack for an
		// instant by design, so queue depth is the wrong thing to read.
		let live = 0;
		let peak = 0;
		await Promise.all(
			Array.from({ length: LIMIT }, () =>
				through(async () => {
					live += 1;
					peak = Math.max(peak, live);
					await new Promise((settle) => setTimeout(settle, 2));
					live -= 1;
				}),
			),
		);
		assert.equal(peak, LIMIT, "something waited for a slot that was free");
	});
});
