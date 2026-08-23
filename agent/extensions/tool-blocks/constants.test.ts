/**
 * The few constants this package cannot derive, held to what they claim.
 *
 * A constant nobody checks is a constant that drifts from the thing it was
 * measured against. These are the ones left after everything derivable was
 * derived, and each is pinned to the source it came from.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { visibleWidth } from "@earendil-works/pi-tui";

import { ICON, LETTER } from "./mark/icons.ts";
import { GUTTER, MARK_COLUMNS, MARK_GAP } from "./mark/frame.ts";
import { SCOPE_TOKENS } from "./bash/scopes.ts";
import { TOOLS } from "./tools/builtins.ts";
import { blank, plain } from "./shared/ansi.ts";

describe("the mark's gutter", () => {
	it("is as wide as the mark plus its gap, not a number of its own", () => {
		assert.equal(GUTTER, MARK_COLUMNS + MARK_GAP);
	});

	it("reserves exactly the columns a mark occupies", () => {
		// A glyph wider than its reservation pushes the first line out of line
		// with the rest. Every mark must measure what MARK_COLUMNS claims.
		for (const [tool, glyph] of Object.entries(ICON)) {
			assert.equal(visibleWidth(glyph), MARK_COLUMNS, `${tool}: ${JSON.stringify(glyph)}`);
		}
		for (const [tool, letter] of Object.entries(LETTER)) {
			assert.equal(visibleWidth(letter), MARK_COLUMNS, `${tool}: ${letter}`);
		}
	});

	it("separates the mark from the title the way pi separates a verb from its object", () => {
		assert.equal(MARK_GAP, 1);
	});
});

describe("the marks", () => {
	it("cover every tool this package takes over", () => {
		assert.deepEqual(Object.keys(ICON).sort(), [...TOOLS].sort());
		assert.deepEqual(Object.keys(LETTER).sort(), [...TOOLS].sort());
	});

	it("give each tool a different letter, so the fallback still tells them apart", () => {
		const letters = Object.values(LETTER);
		assert.equal(new Set(letters).size, letters.length);
	});
});

describe("the scope table", () => {
	it("names tokens, never colours", () => {
		// A colour here would defeat the point: the active theme decides what
		// anything looks like, and a new theme should need no change.
		for (const [, token] of SCOPE_TOKENS) {
			assert.doesNotMatch(token, /^#|\u001b|^\d+$/, token);
		}
	});

	it("holds no duplicate prefix, which would make the order matter", () => {
		const prefixes = SCOPE_TOKENS.map(([prefix]) => prefix);
		assert.equal(new Set(prefixes).size, prefixes.length);
	});

	it("uses TextMate's dotted prefixes, so a longer scope lands on its parent", () => {
		for (const [prefix] of SCOPE_TOKENS) {
			assert.doesNotMatch(prefix, /[*?\\[\]]/, `${prefix} looks like a pattern; these are plain prefixes`);
		}
	});
});

describe("reading styled text", () => {
	it("strips only SGR, leaving every other escape alone", () => {
		// OSC 8 hyperlinks are how pi makes a path clickable; stripping them
		// would silently remove the link from a title.
		const link = "\u001b]8;;file:///x\u001b\\\u001b[38;2;1;2;3mtext\u001b[39m\u001b]8;;\u001b\\";
		assert.equal(plain(link), "\u001b]8;;file:///x\u001b\\text\u001b]8;;\u001b\\");
	});

	it("calls a line blank only when nothing would be seen", () => {
		assert.ok(blank("\u001b[38;2;1;2;3m   \u001b[39m"));
		assert.ok(!blank("\u001b[38;2;1;2;3m x \u001b[39m"));
	});
});
