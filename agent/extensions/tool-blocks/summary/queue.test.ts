import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { drain, LIMIT, pressure, through } from "./queue.ts";

afterEach(drain);

describe("how many sentences are asked for at once", () => {
	it("never has more than the limit in flight", async () => {
		// A rebuilt transcript renders every block, so an opening burst is one
		// request per block at the same instant -- 194 of them in the session
		// this was written in, measured at 50 in flight out of 50 blocks.
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
	});

	it("admits waiters in the order they arrived", async () => {
		const order: number[] = [];
		const held: (() => void)[] = [];
		const first = Array.from({ length: LIMIT }, () =>
			through(() => new Promise<void>((settle) => held.push(settle))),
		);
		const queued = [0, 1, 2].map((at) => through(async () => { order.push(at); }));
		for (const release of held) release();
		await Promise.all([...first, ...queued]);
		assert.deepEqual(order, [0, 1, 2]);
	});

	it("gives the slot back when a request throws", async () => {
		// Otherwise one refusal narrows the gate for the rest of the session.
		await Promise.allSettled(
			Array.from({ length: LIMIT }, () => through(async () => { throw new Error("refused"); })),
		);
		assert.deepEqual(pressure(), { live: 0, queued: 0 });
		await through(async () => {});
	});

	it("does not make a single request wait", async () => {
		// A normal turn runs one to three tools; the queue must be invisible.
		assert.equal(pressure().queued, 0);
		const started = Date.now();
		await through(async () => {});
		assert.ok(Date.now() - started < 50);
	});
});
