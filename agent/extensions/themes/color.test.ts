import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { composite, contrast, format, luminance, parse } from "./color.ts";

describe("parse", () => {
	it("reads the channels in order", () => {
		assert.deepEqual(parse("#191724"), [0x19, 0x17, 0x24]);
	});

	it("accepts either case", () => {
		assert.deepEqual(parse("#C4A7E7"), parse("#c4a7e7"));
	});

	it("rejects anything that is not a 6 digit hex", () => {
		for (const bad of ["#fff", "c4a7e7", "#c4a7e", "#c4a7e77", "", "#gggggg"]) {
			assert.throws(() => parse(bad), /not a 6 digit hex/, `should reject ${JSON.stringify(bad)}`);
		}
	});
});

describe("format", () => {
	it("round trips with parse", () => {
		for (const hex of ["#000000", "#ffffff", "#191724", "#c4a7e7"]) {
			assert.equal(format(parse(hex)), hex);
		}
	});

	it("pads single digit channels", () => {
		assert.equal(format([1, 2, 3]), "#010203");
	});

	it("clamps rather than wrapping", () => {
		assert.equal(format([-10, 300, 128]), "#00ff80");
	});
});

describe("composite", () => {
	it("at alpha 0 is the base", () => {
		assert.equal(composite("#191724", "#9ccfd8", 0), "#191724");
	});

	it("at alpha 1 is the tint", () => {
		assert.equal(composite("#191724", "#9ccfd8", 1), "#9ccfd8");
	});

	it("moves each channel toward the tint", () => {
		const base = parse("#191724");
		const tint = parse("#9ccfd8");
		const mixed = parse(composite("#191724", "#9ccfd8", 0.15));
		for (const i of [0, 1, 2]) {
			assert.ok(mixed[i]! > base[i]!, `channel ${i} should rise toward the lighter tint`);
			assert.ok(mixed[i]! < tint[i]!, `channel ${i} should stay below the tint`);
		}
	});

	it("matches what a GUI would render for the published alpha", () => {
		// rose-pine ships #9ccfd826, catppuccin writes 0.15; 0x26/255 is 0.1490,
		// so the two land within a rounding step of each other rather than equal.
		const published = parse(composite("#191724", "#9ccfd8", 0x26 / 255));
		const ours = parse(composite("#191724", "#9ccfd8", 0.15));
		for (const i of [0, 1, 2]) {
			assert.ok(Math.abs(ours[i]! - published[i]!) <= 1, `channel ${i}: ${ours[i]} vs ${published[i]}`);
		}
	});

	it("rejects an alpha outside 0..1", () => {
		for (const bad of [-0.1, 1.1, Number.NaN]) {
			assert.throws(() => composite("#191724", "#9ccfd8", bad), /alpha out of range/);
		}
	});
});

describe("luminance", () => {
	it("spans black to white", () => {
		assert.equal(luminance("#000000"), 0);
		assert.equal(luminance("#ffffff"), 1);
	});

	it("weights green above red above blue", () => {
		assert.ok(luminance("#00ff00") > luminance("#ff0000"));
		assert.ok(luminance("#ff0000") > luminance("#0000ff"));
	});
});

describe("contrast", () => {
	it("is 21 for black against white", () => {
		assert.equal(Math.round(contrast("#000000", "#ffffff")), 21);
	});

	it("is 1 for a colour against itself", () => {
		assert.equal(contrast("#c4a7e7", "#c4a7e7"), 1);
	});

	it("does not depend on argument order", () => {
		assert.equal(contrast("#191724", "#e0def4"), contrast("#e0def4", "#191724"));
	});
});
