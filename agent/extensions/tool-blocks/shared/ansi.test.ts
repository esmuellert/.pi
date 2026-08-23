import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { truncateToWidth } from "@earendil-works/pi-tui";

import { keepBackground, openingBackground, plain } from "./ansi.ts";

describe("keeping a background alive across a line", () => {
	it("rewrites every spelling of a reset", () => {
		// `0` and an empty parameter list mean the same thing, and `49` closes
		// the background on its own. Matching one literal spelling would leave
		// the other four working exactly as before.
		for (const reset of ["\u001b[0m", "\u001b[m", "\u001b[00m", "\u001b[0;1m", "\u001b[49m"]) {
			const out = keepBackground(reset);
			assert.ok(!/\u001b\[[0-9;]*m/.test(out) || !closesBackground(out), `${JSON.stringify(reset)} still closes it`);
		}
	});

	it("keeps what a reset did to everything else", () => {
		// `0` clears intensity, italic, underline and the rest as well as the
		// colours; dropping that would leave bold running to the line's end.
		assert.equal(keepBackground("\u001b[0m"), "\u001b[39;22;23;24;25;27;29m");
		assert.equal(keepBackground("\u001b[0;1m"), "\u001b[39;22;23;24;25;27;29;1m");
	});

	it("does not read a reset inside a colour", () => {
		// `38;2;R;G;B` is one attribute. rose-pine's pine is rgb(49,116,143),
		// and reading the list parameter by parameter finds a `49` in the red
		// channel -- which, removed, shifts green into red and drops blue.
		for (const colour of [
			"\u001b[38;2;49;116;143m",
			"\u001b[48;5;49m",
			"\u001b[58;2;0;49;0m",
			"\u001b[38;5;0m",
		]) {
			assert.equal(keepBackground(colour), colour);
		}
		// A real reset after a colour is still caught.
		assert.equal(keepBackground("\u001b[1;38;2;0;0;0;49;3m"), "\u001b[1;38;2;0;0;0;3m");
	});

	it("leaves everything else alone", () => {
		for (const sequence of ["\u001b[38;2;1;2;3m", "\u001b[1m", "\u001b[39m", "\u001b[48;2;9;9;9m"]) {
			assert.equal(keepBackground(sequence), sequence);
		}
		assert.equal(keepBackground("plain text"), "plain text");
	});

	it("changes nothing a reader would see", () => {
		const line = "\u001b[38;2;1;2;3mred\u001b[0m then\u001b[49m more";
		assert.equal(plain(keepBackground(line)), plain(line));
	});

	it("is still needed by pi-tui", () => {
		// The whole reason this exists: truncateToWidth closes a cut with a
		// reset that clears the background too. If pi-tui stops doing that,
		// this file is dead weight and should go rather than sit unread.
		const cut = truncateToWidth("\u001b[38;2;1;2;3m" + "x".repeat(80), 20);
		assert.ok(closesBackground(cut), "pi-tui no longer clears the background when truncating");
		assert.ok(!closesBackground(keepBackground(cut)));
	});
});

/** True when a line carries a sequence that would close an open background. */
function closesBackground(line: string): boolean {
	for (const sequence of line.matchAll(/\u001b\[([0-9;]*)m/g)) {
		const params = sequence[1] === "" ? ["0"] : sequence[1]!.split(";");
		if (params.some((p) => Number(p) === 0 || Number(p) === 49)) return true;
	}
	return false;
}

describe("reading the background a line opens with", () => {
	it("still reads one", () => {
		assert.equal(openingBackground("\u001b[48;2;1;2;3mx"), "\u001b[48;2;1;2;3m");
		assert.equal(openingBackground("plain"), undefined);
	});
});
