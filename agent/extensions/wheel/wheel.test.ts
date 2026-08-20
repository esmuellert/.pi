/**
 * Setting the wheel step, and noticing when it can no longer be set.
 *
 * Run: pnpm test
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { applyTo } from "./index.ts";

describe("applying the step", () => {
	it("sets it on the fullscreen TUI", () => {
		const tui = { mode: "fullscreen", wheelScrollLines: 1 };
		assert.deepEqual(applyTo(tui, 3), { applied: true, from: 1, to: 3 });
		assert.equal(tui.wheelScrollLines, 3);
	});

	it("leaves regular mode alone, where the terminal scrolls itself", () => {
		const tui = { mode: "regular", wheelScrollLines: 1 };
		assert.deepEqual(applyTo(tui, 3), { applied: false, reason: "not-fullscreen" });
		assert.equal(tui.wheelScrollLines, 1, "regular mode must not be touched");
	});

	it("reports a renamed field rather than doing nothing quietly", () => {
		// The field is private to pi. If it goes, the wheel silently returns to
		// one line per notch, which is the symptom this extension exists to fix.
		const tui = { mode: "fullscreen" };
		assert.deepEqual(applyTo(tui as never, 3), { applied: false, reason: "field-missing" });
	});

	it("does not invent the field on a TUI that lacks it", () => {
		const tui: Record<string, unknown> = { mode: "fullscreen" };
		applyTo(tui, 3);
		assert.equal("wheelScrollLines" in tui, false);
	});
});

describe("the number", () => {
	it("is written once", () => {
		const source = readFileSync(join(import.meta.dirname, "index.ts"), "utf-8");
		const assignments = [...source.matchAll(/LINES_PER_NOTCH = \d+/g)];
		assert.equal(assignments.length, 1, `${assignments.length} places set the step`);
	});

	it("matches what terminals use for the same gesture", () => {
		// Not a preference: xterm scrolls 5 lines per notch, Windows and Ghostty
		// 3. One is the outlier, and it is pi's.
		const source = readFileSync(join(import.meta.dirname, "index.ts"), "utf-8");
		const step = Number(/LINES_PER_NOTCH = (\d+)/.exec(source)![1]);
		assert.ok(step >= 3 && step <= 5, `${step} is outside what any terminal uses per notch`);
	});
});
