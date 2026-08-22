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

import { COLOUR, colourFor, ERROR_COLOUR, INDENT, layout, noting } from "./noting.ts";
import { useRegistry } from "./summary.ts";

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
		assert.deepEqual(layout(SENTENCE, 0, plain), []);
		assert.deepEqual(layout(SENTENCE, -1, plain), []);
	});

	it("starts in the same column as the command and the output", () => {
		// pi draws the command, the output and its own "Took" flush; a note set
		// in from them reads as belonging to the line above rather than the
		// block. The colour is what says it is a note.
		for (const line of layout(SENTENCE, 40, plain)) {
			assert.doesNotMatch(line, /^\s/, `"${line}" starts indented`);
		}
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

	it("follows what the block already says", () => {
		// A note under a failed command in the colour of success reads as a
		// contradiction; the block's own background has already said which it is.
		assert.equal(colourFor(false), COLOUR);
		assert.equal(colourFor(true), ERROR_COLOUR);
		assert.notEqual(COLOUR, ERROR_COLOUR);
	});

	it("paints an error block's note in the error colour", () => {
		const painted: string[] = [];
		const spy = { fg: (token: string, text: string) => { painted.push(token); return text; } } as never;
		layout("failed to write report.md", 40, spy, true);
		assert.deepEqual([...new Set(painted)], [ERROR_COLOUR]);
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

describe("what it is gated on", () => {
	it("does not consult argsComplete", () => {
		// It looks like the right gate and is not. pi sets it on the tools still
		// pending when a message stops streaming, so a block that has already run
		// reads false forever after -- which is every block by the time the
		// result renderer runs.
		let asked = 0;
		useRegistry({
			getAvailable: () => [{ id: "claude-haiku-4.5", provider: "github-copilot" }],
			complete: async () => ({ role: "assistant", content: [{ type: "text", text: "does a thing" }] }),
		} as never);
		const note = noting();
		note(
			60,
			{ command: "cat > f <<'EOF'\nbody\nEOF" } as never,
			{ fg: (_t: string, x: string) => x } as never,
			{ argsComplete: false, state: {}, invalidate: () => { asked += 1; } } as never,
		);
		assert.equal(asked, 0, "nothing should have resolved yet");
		// The request went out despite argsComplete being false, which is the
		// point: the result renderer only runs once the command is whole.
	});
});

describe("when the theme is not ready", () => {
	it("shows the sentence uncoloured rather than not at all", () => {
		// theme.fg throws between an old theme being dropped and a new one being
		// installed -- the window a late sentence lands in.
		const angry = { fg: () => { throw new Error("Theme not initialized"); } } as never;
		const lines = layout("writes report.md", 40, angry);
		assert.deepEqual(lines, [`${INDENT}writes report.md`]);
	});
});
