// The ladders are the load-bearing part of a Semantics: derive.ts reads rungs by
// position, so a ladder listed out of order silently produces a theme where the
// "raised" surface is darker than the panel it sits on.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { contrast, luminance } from "./color.ts";
import { PALETTES } from "./palettes.ts";
import { catppuccinSemantics, rolesUsed, rosePineSemantics, semanticsFor } from "./semantics.ts";

describe("semanticsFor", () => {
	it("gives every palette a vocabulary", () => {
		for (const palette of PALETTES) assert.ok(semanticsFor(palette), palette.name);
	});

	it("groups variants of a project together", () => {
		for (const palette of PALETTES) {
			const expected = palette.name.startsWith("rose-pine") ? rosePineSemantics : catppuccinSemantics;
			assert.equal(semanticsFor(palette), expected, palette.name);
		}
	});

	it("describes both projects with the same set of ideas", () => {
		assert.deepEqual(Object.keys(rosePineSemantics).sort(), Object.keys(catppuccinSemantics).sort());
	});
});

describe("ladders", () => {
	for (const palette of PALETTES) {
		const semantics = semanticsFor(palette);
		const lum = (role: string) => luminance(palette.roles[role]!);

		it(`${palette.name} lists surfaces darkest first`, () => {
			for (let i = 1; i < semantics.surfaces.length; i += 1) {
				const [below, above] = [semantics.surfaces[i - 1]!, semantics.surfaces[i]!];
				assert.ok(lum(above) > lum(below), `${above} is not lighter than ${below}`);
			}
		});

		it(`${palette.name} lists neutrals dimmest first`, () => {
			for (let i = 1; i < semantics.neutrals.length; i += 1) {
				const [below, above] = [semantics.neutrals[i - 1]!, semantics.neutrals[i]!];
				assert.ok(lum(above) > lum(below), `${above} is not brighter than ${below}`);
			}
		});

		it(`${palette.name} has enough rungs for the rules to read`, () => {
			// derive.ts reads surfaces 0..2 and -1, -2, and neutrals -1, -2, -3.
			assert.ok(semantics.surfaces.length >= 4, `only ${semantics.surfaces.length} surfaces`);
			assert.ok(semantics.neutrals.length >= 3, `only ${semantics.neutrals.length} neutrals`);
		});

		it(`${palette.name} starts its surfaces at the background the theme assumes`, () => {
			assert.equal(semantics.surfaces[0], "base", "surfaces[0] is what everything is composited over");
		});

		it(`${palette.name} ends its neutrals at readable body text`, () => {
			const body = palette.roles[semantics.neutrals.at(-1)!]!;
			const ratio = contrast(body, palette.roles.base!);
			assert.ok(ratio >= 7, `body text is ${ratio.toFixed(1)}:1, below the 7:1 AAA bar`);
		});

		it(`${palette.name} names only roles it has`, () => {
			for (const role of rolesUsed(semantics)) {
				assert.ok(palette.roles[role], `no role "${role}"`);
			}
		});

		it(`${palette.name} keeps its signature clear of the status accents`, () => {
			// The signature is decoration; if it doubled as the error colour, the
			// accent and a failure would be indistinguishable.
			for (const status of [semantics.error, semantics.warning, semantics.success] as const) {
				assert.notEqual(
					palette.roles[semantics.signature],
					palette.roles[status],
					"the signature accent also means a status",
				);
			}
		});
	}
});

describe("what may not share a colour", () => {
	/**
	 * A palette has fewer accents than there are things to say with them, so
	 * sharing is not a fault -- rose-pine has six for thirteen roles. What
	 * matters is that two roles sharing a colour are saying compatible things.
	 */
	for (const [name, semantics] of [["rose-pine", rosePineSemantics], ["catppuccin", catppuccinSemantics]] as const) {
		describe(name, () => {
			it("does not colour a heading like a warning", () => {
				// A heading marks structure. Painting it the warning colour says
				// something is wrong with every section title on the page, and in
				// rose-pine that colour is also the palette's loudest.
				assert.notEqual(
					semantics.heading,
					semantics.warning,
					"a section title would read as something being wrong",
				);
			});

			it("does not colour a heading like an error", () => {
				assert.notEqual(semantics.heading, semantics.error);
			});

			it("keeps error and success apart, which is the one pair nothing may merge", () => {
				assert.notEqual(semantics.error, semantics.success);
			});

			it("keeps the signature off the three states", () => {
				// The signature is the colour the palette is known by, used for
				// links and hints. It must not double as an outcome.
				for (const state of ["error", "warning", "success"] as const) {
					assert.notEqual(semantics.signature, semantics[state], `signature doubles as ${state}`);
				}
			});
		});
	}
});
