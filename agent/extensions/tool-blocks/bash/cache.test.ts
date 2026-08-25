/**
 * The cost of rendering, which is not a detail at this scale.
 *
 * Run: pnpm test
 *
 * Every tool block re-renders on every frame, so anything done per render is
 * done once per block per keystroke. Tokenising a command is half a
 * millisecond, which is nothing until a session holds eight hundred of them:
 * typing became visibly laggy, and the cause was here rather than in the size
 * of the session.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, describe, it } from "node:test";

import { speedup, tooSlow } from "frame-budget";

import { forget, prepare, tokenize } from "./engine.ts";
import { retitling } from "./title.ts";
import { builtIn } from "../tools/builtins.ts";
import { present } from "../tools/override.ts";

const COMMANDS: string[] = JSON.parse(
	readFileSync(join(import.meta.dirname, "fixtures/commands.json"), "utf-8"),
);

const probe = {
	fg: (_token: string, text: string) => `\u001b[38;2;1;2;3m${text}\u001b[39m`,
	bold: (text: string) => `\u001b[1m${text}\u001b[22m`,
} as never;

/**
 * A session's worth of blocks, each with the per-row state pi would give it.
 *
 * Every command distinct. A real session repeats itself, and the tokeniser cache
 * is keyed on the command, so repeated blocks are served from it whether or not
 * the cache is working for the case that matters. Sixty fixtures across eight
 * hundred blocks left only sixty tokenisations to save, which a broken cache
 * could lose without the timings moving.
 */
const blocks = (count: number) =>
	Array.from({ length: count }, (_, index) => ({
		command: `${COMMANDS[index % COMMANDS.length]!} # ${index}`,
		state: {} as Record<string, unknown>,
	}));

describe("tokenising is remembered", () => {
	before(async () => {
		await prepare();
	});

	it("returns the same pieces for the same command without redoing the work", () => {
		forget();
		const command = COMMANDS[0]!;
		const first = tokenize(command);
		assert.deepEqual(tokenize(command), first);
		// Identity, not equality: a second tokenisation would build new objects.
		assert.equal(tokenize(command), first);
	});

	it("survives being forgotten, which is what a cold render is", () => {
		const command = COMMANDS[1]!;
		const before = tokenize(command);
		forget();
		assert.deepEqual(tokenize(command), before);
	});
});

describe("what pi renders and nobody reads", () => {
	before(async () => {
		await prepare();
	});

	it("is not produced when the retitle replaces it outright", () => {
		// Producing it costs pi a full render per block per frame. A retitle that
		// ignores it should not be charged for it.
		let renders = 0;
		const inner = { render: () => (renders += 1, ["pi's own title"]), invalidate: () => {} };
		const definition = present("bash", process.cwd(), {
			retitle: retitling(),
		}, { ...builtIn("bash", process.cwd()), renderCall: () => inner } as never);
		definition.renderCall!({ command: "ls -la" } as never, probe, { state: {}, expanded: true, cwd: process.cwd() } as never).render(80);
		assert.equal(renders, 0, "pi's rendering was produced and discarded");
	});

	it("is produced once when a retitle declines", () => {
		let renders = 0;
		const inner = { render: () => (renders += 1, ["pi's own title"]), invalidate: () => {} };
		const definition = present("bash", process.cwd(), {
			retitle: () => undefined,
		}, { ...builtIn("bash", process.cwd()), renderCall: () => inner } as never);
		definition.renderCall!({ command: "ls -la" } as never, probe, { state: {}, expanded: true, cwd: process.cwd() } as never).render(80);
		assert.equal(renders, 1, "asking for it and then declining should not render twice");
	});
});

describe("a session's worth of blocks", () => {
	before(async () => {
		await prepare();
	});

	it("costs nothing on a frame where nothing changed", () => {
		// This is the frame that happens on every keystroke.
		const rows = blocks(800);
		const retitle = retitling();
		const draw = (width: number) => {
			for (const row of rows) retitle(() => [], width, { command: row.command } as never, probe, { state: row.state, expanded: true, cwd: process.cwd() } as never);
		};
		const ratio = speedup(
			() => {
				forget();
				for (const row of rows) row.state = {};
				draw(80);
			},
			() => draw(80),
		);
		// Nothing changed, so nothing should be recomputed: the row keeps its
		// lines. Measured here in the thousands; a hundred is far below that and
		// far above anything a cache that stopped working could reach.
		assert.equal(tooSlow(ratio, 100), undefined);
	});

	it("stays out of a freeze when the width changes", () => {
		let draws = 0;
		const rows = blocks(800);
		const retitle = retitling();
		const draw = (width: number) => {
			for (const row of rows) retitle(() => [], width, { command: row.command } as never, probe, { state: row.state, expanded: true, cwd: process.cwd() } as never);
		};
		draw(80);
		// A resize has to rewrap every block -- that work is unavoidable -- but
		// it must not tokenise them again. Measured at five times cheaper than
		// doing both; two is the floor, and a cache that stopped working would
		// sit at one.
		const ratio = speedup(
			() => {
				forget();
				for (const row of rows) row.state = {};
				draw(80);
			},
			() => draw(draws++ % 2 ? 60 : 61),
		);
		assert.equal(tooSlow(ratio, 2), undefined);
	});
});
