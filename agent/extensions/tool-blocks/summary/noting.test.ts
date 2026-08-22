/**
 * How the sentence is laid out under a block.
 *
 * Run: pnpm test
 *
 * It was one line before this, so anything longer than the terminal ran off
 * the side and was cut.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { visibleWidth } from "@earendil-works/pi-tui";

import { COLOUR, INDENT, layout } from "./noting.ts";

/** A theme that leaves the text alone, so widths are the text's own. */
const plain = { fg: (_token: string, text: string) => text } as never;

const SENTENCE = "generates two hundred rows of test data and writes them to sales.csv";

describe("laying out a sentence", () => {
	it("wraps instead of running off the side", () => {
		const lines = layout(SENTENCE, 30, plain);
		assert.ok(lines.length > 1, "a sentence wider than the block should take more than one line");
		for (const line of lines) assert.ok(visibleWidth(line) <= 30, `"${line}" is wider than the block`);
	});

	it("keeps every line under the same indent", () => {
		// Continuations that start at column zero read as the block's output
		// rather than as a note about it.
		for (const line of layout(SENTENCE, 30, plain)) assert.ok(line.startsWith(INDENT));
	});

	it("loses no words", () => {
		const joined = layout(SENTENCE, 24, plain).map((line) => line.trim()).join(" ");
		assert.equal(joined, SENTENCE);
	});

	it("stays on one line when it fits", () => {
		assert.deepEqual(layout("counts rows", 40, plain), [`${INDENT}counts rows`]);
	});

	it("says nothing rather than mangle when there is no room", () => {
		assert.deepEqual(layout(SENTENCE, 2, plain), []);
		assert.deepEqual(layout(SENTENCE, 0, plain), []);
	});
});

describe("the colour it is painted in", () => {
	it("is not the one the block's own output uses", () => {
		// `muted` and `toolOutput` resolve to the same colour in rose-pine, so a
		// note painted with either read as more output rather than as a note.
		assert.notEqual(COLOUR, "muted");
		assert.notEqual(COLOUR, "toolOutput");
		assert.notEqual(COLOUR, "toolTitle");
	});

	it("is a token, so every theme picks its own", () => {
		// A hex here would be rose-pine's answer imposed on catppuccin.
		assert.doesNotMatch(COLOUR, /^#/);
	});

	it("is the token every line is painted with", () => {
		const painted: string[] = [];
		layout("a sentence long enough to wrap across two lines here", 24, {
			fg: (token: string, text: string) => {
				painted.push(token);
				return text;
			},
		} as never);
		assert.ok(painted.length > 1, "the sample should have wrapped");
		assert.deepEqual([...new Set(painted)], [COLOUR]);
	});
});
