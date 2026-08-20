import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Component } from "@earendil-works/pi-tui";

import { GUTTER, withMark } from "./wrap.ts";

/** A component that reports the width it was asked to render at. */
function stub(lines: string[] | ((width: number) => string[])): Component & { widths: number[]; invalidated: number } {
	const seen: number[] = [];
	let invalidated = 0;
	return {
		get widths() {
			return seen;
		},
		get invalidated() {
			return invalidated;
		},
		render(width: number) {
			seen.push(width);
			return typeof lines === "function" ? lines(width) : lines;
		},
		invalidate() {
			invalidated += 1;
		},
	} as Component & { widths: number[]; invalidated: number };
}

describe("withMark", () => {
	it("puts the mark on the first line", () => {
		const out = withMark(stub(["read ~/file.ts"]), "*").render(40);
		assert.equal(out[0], `*${" ".repeat(GUTTER - 1)}read ~/file.ts`);
	});

	it("indents the rest to line up under it", () => {
		const out = withMark(stub(["one", "two", "three"]), "*").render(40);
		assert.deepEqual(out.slice(1), [`${" ".repeat(GUTTER)}two`, `${" ".repeat(GUTTER)}three`]);
	});

	it("starts every line's text in the same column", () => {
		// trimStart cannot measure this: the first line begins with the mark, not
		// with the space the others begin with.
		const out = withMark(stub(["one", "two"]), "*").render(40);
		assert.deepEqual(
			out.map((line) => line.slice(GUTTER)),
			["one", "two"],
		);
	});

	it("tells the inner component the width it will really have", () => {
		// Otherwise it wraps against a width three columns wider than the space
		// it is drawn in, and every long line spills.
		const inner = stub(["x"]);
		withMark(inner, "*").render(40);
		assert.deepEqual(inner.widths, [40 - GUTTER]);
	});

	it("never asks for a width below one", () => {
		const inner = stub(["x"]);
		withMark(inner, "*").render(1);
		assert.ok(inner.widths[0]! >= 1, `asked for ${inner.widths[0]}`);
	});

	it("leaves an empty component alone rather than orphaning the mark", () => {
		for (const empty of [[], [""], ["", "  "], ["\u001b[32m \u001b[39m"]]) {
			const out = withMark(stub(empty), "*").render(40);
			assert.deepEqual(out, empty, JSON.stringify(empty));
		}
	});

	it("marks the first line that says something, not the first line", () => {
		// A tool that draws its own frame opens with a blank padding line; the
		// mark belongs on its title, not floating above it.
		const out = withMark(stub(["", "edit ~/file.ts", ""]), "*").render(40);
		assert.equal(out[0], `${" ".repeat(GUTTER)}`);
		assert.equal(out[1], `*${" ".repeat(GUTTER - 1)}edit ~/file.ts`);
	});

	it("sees through colour when deciding what is blank", () => {
		const painted = "\u001b[48;2;31;29;46m   \u001b[49m";
		const out = withMark(stub([painted, "edit ~/x"]), "*").render(40);
		assert.ok(out[1]!.startsWith("*"), "the mark should have skipped the painted padding");
	});

	it("keeps whatever styling the mark already carries", () => {
		const styled = "\u001b[32m*\u001b[39m";
		assert.ok(withMark(stub(["x"]), styled).render(40)[0]!.startsWith(styled));
	});

	it("does not touch the title's own text", () => {
		const title = "\u001b]8;;file:///x\u001b\\\u001b[35m~/x\u001b[39m\u001b]8;;\u001b\\";
		assert.ok(withMark(stub([title]), "*").render(40)[0]!.endsWith(title));
	});

	it("forwards invalidate, which pi calls when the theme changes", () => {
		const inner = stub(["x"]);
		withMark(inner, "*").invalidate();
		assert.equal(inner.invalidated, 1);
	});

	it("forwards input only when the inner component wanted it", () => {
		assert.equal(typeof withMark(stub(["x"]), "*").handleInput, "undefined");

		const typed: string[] = [];
		const interactive = { ...stub(["x"]), handleInput: (data: string) => typed.push(data) } as Component;
		withMark(interactive, "*").handleInput?.("a");
		assert.deepEqual(typed, ["a"]);
	});

	it("carries wantsKeyRelease across, only when it was set", () => {
		assert.equal(withMark(stub(["x"]), "*").wantsKeyRelease, undefined);
		const wants = { ...stub(["x"]), wantsKeyRelease: true } as Component;
		assert.equal(withMark(wants, "*").wantsKeyRelease, true);
	});

	it("re-reads the inner component every render, so streaming updates show", () => {
		let call = 0;
		const changing = stub(() => [`call ${(call += 1)}`]);
		const wrapped = withMark(changing, "*");
		assert.notEqual(wrapped.render(40)[0], wrapped.render(40)[0]);
	});
});
