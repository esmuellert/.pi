// Guards on the seam between upstream's shape and ours. If either package
// changes how it publishes colours, this file is where it should be noticed.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { flavors } from "@catppuccin/palette";
import { variants } from "@rose-pine/palette";

import { catppuccinMocha, normaliseHex, PALETTES, rosePine } from "./palettes.ts";

describe("normaliseHex", () => {
	it("accepts the bare form rose-pine publishes", () => {
		assert.equal(normaliseHex("c4a7e7", "test"), "#c4a7e7");
	});

	it("accepts the prefixed form catppuccin publishes", () => {
		assert.equal(normaliseHex("#cba6f7", "test"), "#cba6f7");
	});

	it("lowercases, so comparisons elsewhere can be plain equality", () => {
		assert.equal(normaliseHex("#CBA6F7", "test"), "#cba6f7");
	});

	it("names the offender when a value is unusable", () => {
		assert.throws(() => normaliseHex("nope", "catppuccin mocha.mauve"), /catppuccin mocha\.mauve/);
	});

	it("rejects short and long forms rather than padding them", () => {
		for (const bad of ["fff", "#fff", "c4a7e", "c4a7e77"]) {
			assert.throws(() => normaliseHex(bad, "test"), /unusable hex/, `should reject ${bad}`);
		}
	});
});

describe("upstream shape", () => {
	it("still publishes rose-pine hexes without a leading #", () => {
		// If this flips, normaliseHex already copes, but the comment above it is wrong.
		assert.doesNotMatch(variants.main.colors.iris.hex, /^#/);
	});

	it("still publishes catppuccin hexes with a leading #", () => {
		assert.match(flavors.mocha.colors.mauve.hex, /^#/);
	});

	it("agrees with us on a colour we can name from memory", () => {
		assert.equal(rosePine.roles.iris, "#c4a7e7");
		assert.equal(catppuccinMocha.roles.mauve, "#cba6f7");
	});

	it("still carries the highlight roles the mapping needs", () => {
		// These are absent from the repo's root palette.json but present in the
		// package, which is why the package is the dependency.
		for (const role of ["highlightLow", "highlightMed", "highlightHigh"]) {
			assert.ok(rosePine.roles[role], `rose-pine lost ${role}`);
		}
	});
});

describe("palettes", () => {
	it("exposes the five themes we ship", () => {
		assert.deepEqual(
			PALETTES.map((p) => p.name),
			["rose-pine", "rose-pine-moon", "catppuccin-frappe", "catppuccin-macchiato", "catppuccin-mocha"],
		);
	});

	it("gives every palette a base to composite over", () => {
		for (const palette of PALETTES) assert.ok(palette.roles.base, `${palette.name} has no base`);
	});

	it("normalises every colour it exposes", () => {
		for (const palette of PALETTES) {
			for (const [role, value] of Object.entries(palette.roles)) {
				assert.match(value, /^#[0-9a-f]{6}$/, `${palette.name}.${role}`);
			}
		}
	});

	it("names each palette uniquely, since pi keys themes by name", () => {
		const names = PALETTES.map((p) => p.name);
		assert.equal(new Set(names).size, names.length);
	});

	it("gives each palette a distinct base, so they are told apart on sight", () => {
		const bases = PALETTES.map((p) => p.roles.base);
		assert.equal(new Set(bases).size, bases.length);
	});
});
