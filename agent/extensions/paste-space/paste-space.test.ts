/**
 * Spacing an insertion from what it lands between.
 *
 * Run: pnpm test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { around, wrap } from "./index.ts";
import { needsSpaceAfter, needsSpaceBefore, separated } from "./separate.ts";

const PNG = "/tmp/pi-clipboard-e58.png";
const JPG = "/tmp/moshi-paste-384.jpg";

describe("deciding on a space", () => {
	it("adds one between two things that would otherwise touch", () => {
		assert.equal(separated(JPG, { before: PNG, after: "" }), ` ${JPG}`);
	});

	it("adds none at the start of a line", () => {
		assert.equal(separated(PNG, { before: "", after: "" }), PNG);
	});

	it("adds none where there already is one", () => {
		assert.equal(separated(JPG, { before: `${PNG} `, after: "" }), JPG);
		assert.equal(separated(` ${JPG}`, { before: PNG, after: "" }), ` ${JPG}`);
	});

	it("separates the far end too, so what is typed next does not stick", () => {
		assert.equal(separated(PNG, { before: "", after: "and this" }), `${PNG} `);
	});

	it("does both ends when dropped into the middle of a word", () => {
		assert.equal(separated(PNG, { before: "look", after: "here" }), ` ${PNG} `);
	});

	it("asks nothing about what the text is", () => {
		// A path, a word and a sentence all need the same gap. Inspecting the
		// text to decide is how a rule like this starts mangling ordinary typing.
		for (const text of [PNG, "word", "a whole sentence", "42"]) {
			assert.equal(needsSpaceBefore(text, { before: "x", after: "" }), true, text);
			assert.equal(needsSpaceBefore(text, { before: "x ", after: "" }), false, text);
		}
	});

	it("leaves an empty insertion alone", () => {
		assert.equal(separated("", { before: "x", after: "y" }), "");
		assert.equal(needsSpaceBefore("", { before: "x", after: "" }), false);
		assert.equal(needsSpaceAfter("", { before: "", after: "y" }), false);
	});

	it("counts a newline as a separator, not just a space", () => {
		assert.equal(separated(PNG, { before: "line\n", after: "" }), PNG);
	});
});

describe("reading the cursor's surroundings", () => {
	const editor = (lines: string[], line: number, col: number) => ({
		getLines: () => lines,
		getCursor: () => ({ line, col }),
	});

	it("splits the line the cursor is on", () => {
		assert.deepEqual(around(editor(["hello world"], 0, 5)), { before: "hello", after: " world" });
	});

	it("uses that line and no other", () => {
		// pi's own insertion works on state.lines[cursorLine], so anything wider
		// would answer a different question than the one being asked.
		assert.deepEqual(around(editor(["first", "second"], 1, 3)), { before: "sec", after: "ond" });
	});

	it("gives up rather than guess when the editor cannot say", () => {
		assert.equal(around({ getCursor: () => ({ line: 0, col: 0 }) }), undefined);
		assert.equal(around({ getLines: () => ["x"] }), undefined);
		assert.equal(around(editor(["x"], 9, 0)), undefined);
	});
});

describe("wrapping the editor", () => {
	const spy = (lines: string[], col: number) => {
		const inserted: string[] = [];
		return {
			editor: {
				getLines: () => lines,
				getCursor: () => ({ line: 0, col }),
				insertTextAtCursor(text: string) {
					inserted.push(text);
				},
			},
			inserted,
		};
	};

	it("spaces what the original would have jammed together", () => {
		const { editor, inserted } = spy([PNG], PNG.length);
		wrap(editor);
		editor.insertTextAtCursor(JPG);
		assert.deepEqual(inserted, [` ${JPG}`]);
	});

	it("wraps once, however many times a session starts", () => {
		const { editor, inserted } = spy([PNG], PNG.length);
		wrap(editor);
		wrap(editor);
		wrap(editor);
		editor.insertTextAtCursor(JPG);
		assert.deepEqual(inserted, [` ${JPG}`], "wrappers stacked");
	});

	it("reports an editor it cannot wrap instead of doing nothing quietly", () => {
		// A missing method means pi changed the editor, and the symptom of
		// silence here is the run-together paths this exists to prevent.
		assert.equal(wrap({}), false);
	});

	it("passes the text through when the cursor cannot be located", () => {
		const inserted: string[] = [];
		const editor = {
			insertTextAtCursor(text: string) {
				inserted.push(text);
			},
		};
		wrap(editor);
		editor.insertTextAtCursor(JPG);
		assert.deepEqual(inserted, [JPG], "a missing cursor must not change the text");
	});
});
