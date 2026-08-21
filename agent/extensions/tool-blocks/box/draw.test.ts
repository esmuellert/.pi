/**
 * The three framings, and what each of them says.
 *
 * Run: pnpm test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { visibleWidth } from "@earendil-works/pi-tui";

import { COLUMNS, type Frame, frame } from "./draw.ts";
import { framing } from "./index.ts";

const plain = { rule: (t: string) => t, head: (t: string) => t };
const KINDS: Frame[] = ["rail", "bracket", "box"];

describe("every framing", () => {
	for (const kind of KINDS) {
		it(`${kind} keeps the content it was given`, () => {
			const lines = frame(["alpha", "beta"], 40, kind, plain);
			for (const text of ["alpha", "beta"]) {
				assert.ok(lines.some((line) => line.includes(text)), `${kind} lost ${text}`);
			}
		});

		it(`${kind} never runs past the width`, () => {
			for (let width = 6; width <= 60; width += 1) {
				for (const line of frame(["some content here"], width, kind, plain)) {
					assert.ok(visibleWidth(line) <= width, `${kind} at ${width}: ${visibleWidth(line)}`);
				}
			}
		});

		it(`${kind} gives up rather than mangle below its own width`, () => {
			const lines = ["x"];
			assert.deepEqual(frame(lines, COLUMNS[kind], kind, plain), lines);
		});

		it(`${kind} halves join into what the whole would be`, () => {
			// pi renders the title and the result as two sibling components, so
			// a framing that closes is drawn in halves that must meet.
			const whole = frame(["a", "b"], 40, kind, plain, "whole");
			const halves = [...frame(["a"], 40, kind, plain, "head"), ...frame(["b"], 40, kind, plain, "tail")];
			assert.deepEqual(halves, whole);
		});
	}
});

describe("what each framing costs", () => {
	it("box spends two more columns than the others, for a right-hand rule", () => {
		assert.equal(COLUMNS.box, COLUMNS.rail + 2);
		assert.equal(COLUMNS.rail, COLUMNS.bracket);
	});

	it("only box states where a block ends on every side", () => {
		const rail = frame(["x"], 30, "rail", plain);
		const bracket = frame(["x"], 30, "bracket", plain);
		const box = frame(["x"], 30, "box", plain);
		assert.equal(rail.length, 1, "a rail adds no rows");
		assert.equal(bracket.length, 2, "a bracket adds a foot");
		assert.equal(box.length, 3, "a box adds a rule above and below");
	});
});

describe("the head", () => {
	for (const kind of KINDS) {
		it(`${kind} paints its first row differently, since that is where the outcome goes`, () => {
			const painted = frame(["title"], 30, kind, { rule: (t) => `R${t}`, head: (t) => `H${t}` }, "head");
			assert.ok(painted[0]!.startsWith("H"), `${kind} head not painted: ${painted[0]}`);
			if (painted.length > 1) assert.ok(painted[1]!.startsWith("R"));
		});

		it(`${kind} opens only when it is the head`, () => {
			const tail = frame(["x"], 30, kind, { rule: (t) => `R${t}`, head: (t) => `H${t}` }, "tail");
			assert.ok(!tail[0]!.startsWith("H"), `${kind} opened in the tail`);
		});
	}
});

describe("a component with nothing to render", () => {
	/**
	 * `read` and `edit` say everything in their title and render no result at
	 * all. By the time that is known the head has already opened a frame, so a
	 * tail with nothing in it still has to close one -- otherwise the framing
	 * hangs open and runs into the next block.
	 *
	 * That decision belongs to the component wrapper rather than to the
	 * drawing, which has no idea whether it was given nothing or asked to draw
	 * nothing.
	 */
	const empty = { render: () => [], invalidate() {} };
	const context = { isPartial: false, isError: false } as never;
	const theme = { fg: (_t: string, s: string) => s } as never;

	for (const kind of KINDS) {
		it(`${kind} closes when the result is empty`, () => {
			const closing = framing(kind, theme, context, "tail")(empty).render(30);
			assert.equal(closing.length, kind === "rail" ? 0 : 1, `${kind}: ${JSON.stringify(closing)}`);
		});

		it(`${kind} does not open for a head with nothing in it`, () => {
			assert.deepEqual(framing(kind, theme, context, "head")(empty).render(30), []);
		});
	}
});
