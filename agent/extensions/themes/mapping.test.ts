// The point of this file: prove "strictly official" rather than assert it.
//
// Every colour in every generated theme is traced back to a role in the vendored
// upstream palette. A hand-typed hex, a tweaked shade, or a role that quietly
// disappeared upstream all fail here.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildTheme, resolve, varName } from "./build.ts";
import { composite } from "./color.ts";
import { catppuccinMapping, mappingFor, rosePineMapping, STATE_TINT } from "./mapping.ts";
import { PALETTES, type Palette } from "./palettes.ts";

const officialValues = (p: Palette) => new Set(Object.values(p.roles).map((v) => v.toLowerCase()));

describe("every colour is upstream", () => {
	for (const palette of PALETTES) {
		describe(palette.name, () => {
			const { colors, export: exported } = mappingFor(palette.name);
			const mapping = { ...colors, ...exported };
			const official = officialValues(palette);

			it("names only roles the palette defines", () => {
				for (const [token, ref] of Object.entries(mapping)) {
					const names = "role" in ref ? [ref.role] : [ref.over, ref.tint];
					for (const name of names) {
						assert.ok(palette.roles[name], `${token} names "${name}", absent from ${palette.name}`);
					}
				}
			});

			it("uses palette values verbatim wherever it is not tinting", () => {
				for (const [token, ref] of Object.entries(mapping)) {
					if (!("role" in ref)) continue;
					assert.ok(
						official.has(resolve(palette, ref).toLowerCase()),
						`${token} resolved off palette`,
					);
				}
			});

			it("tints only by the published alpha, from two palette colours", () => {
				const tints = Object.entries(mapping).filter(([, ref]) => !("role" in ref));
				assert.ok(tints.length > 0, "expected at least one state-tinted surface");
				for (const [token, ref] of tints) {
					if ("role" in ref) continue;
					const expected = composite(palette.roles[ref.over]!, palette.roles[ref.tint]!, STATE_TINT);
					assert.equal(resolve(palette, ref), expected, `${token} is not the published composite`);
				}
			});

			it("emits no colour that is neither a palette value nor a declared tint", () => {
				const theme = buildTheme(palette);
				const allowed = new Set(official);
				for (const ref of Object.values(mapping)) {
					if (!("role" in ref)) allowed.add(resolve(palette, ref).toLowerCase());
				}
				for (const [name, value] of Object.entries(theme.vars)) {
					assert.ok(allowed.has(value.toLowerCase()), `var ${name} = ${value} is not upstream`);
				}
				for (const value of Object.values(theme.export)) {
					assert.ok(allowed.has(value.toLowerCase()), `export ${value} is not upstream`);
				}
			});
		});
	}
});

describe("mappings", () => {
	it("cover the same tokens as each other", () => {
		assert.deepEqual(Object.keys(rosePineMapping).sort(), Object.keys(catppuccinMapping).sort());
	});

	it("send rose-pine palettes to the rose-pine mapping", () => {
		for (const palette of PALETTES) {
			const expected = palette.name.startsWith("rose-pine") ? rosePineMapping : catppuccinMapping;
			assert.equal(mappingFor(palette.name).colors, expected, palette.name);
		}
	});

	it("map the same export tokens for both projects", () => {
		assert.deepEqual(
			Object.keys(mappingFor("rose-pine").export).sort(),
			Object.keys(mappingFor("catppuccin-mocha").export).sort(),
		);
	});

	it("keep success and error visibly apart", () => {
		for (const palette of PALETTES) {
			const theme = buildTheme(palette);
			assert.notEqual(
				theme.vars[theme.colors.toolSuccessBg!],
				theme.vars[theme.colors.toolErrorBg!],
				`${palette.name} would show the same background for success and failure`,
			);
			assert.notEqual(
				theme.vars[theme.colors.toolSuccessBg!],
				theme.vars[theme.colors.toolPendingBg!],
				`${palette.name} would show the same background for success and pending`,
			);
		}
	});

	it("uses the published alpha", () => {
		// Both projects state 0.15 for a state-tinted line; rose-pine writes it as #..26.
		assert.equal(STATE_TINT, 0.15);
		assert.equal(Math.round(0x26 / 255 * 100) / 100, STATE_TINT);
	});
});

describe("varName", () => {
	it("keeps the upstream role name so provenance shows in the output", () => {
		assert.equal(varName({ role: "iris" }), "iris");
	});

	it("names a tint after both of its inputs", () => {
		assert.equal(varName({ over: "base", tint: "foam" }), "foamOnBase");
	});

	it("gives different tints different names", () => {
		assert.notEqual(varName({ over: "base", tint: "foam" }), varName({ over: "base", tint: "love" }));
	});
});
