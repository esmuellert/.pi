// The architectural claim this file exists to check: the rules in derive.ts are
// about a palette's structure, not about rose-pine or catppuccin. If any colour
// name leaked into them, the synthetic palette below would fail to produce a
// theme, because none of its roles is called anything either project uses.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { contrast } from "./color.ts";
import { BORDER_FLOOR, derive, resolve, STATE_TINT, thinkingRamp, varName, type Ref } from "./derive.ts";
import { PALETTES, type Palette } from "./palettes.ts";
import { rolesUsed, semanticsFor, type Semantics } from "./semantics.ts";

/**
 * A palette that shares no vocabulary with either real one: five surfaces named
 * after floors, four greys named after weather, and accents named after fruit.
 */
const invented: Palette = {
	name: "invented",
	note: "a palette no rule in derive.ts can have been written for",
	roles: {
		cellar: "#101014",
		ground: "#20202a",
		first: "#2e2e3c",
		second: "#3c3c4e",
		roof: "#4b4b60",
		fog: "#6b6b80",
		haze: "#8f8fa6",
		mist: "#b4b4c6",
		clear: "#e6e6f0",
		plum: "#c9b0ee",
		cherry: "#e07a94",
		apricot: "#e0b884",
		lime: "#9ed49c",
		berry: "#8fb8e0",
		fig: "#9ed4cc",
	},
};

const inventedSemantics: Semantics = {
	surfaces: ["cellar", "ground", "first", "second", "roof"],
	neutrals: ["fog", "haze", "mist", "clear"],
	signature: "plum",
	decoration: "fig",
	error: "cherry",
	warning: "apricot",
	success: "lime",
	link: "berry",
	info: "berry",
	comment: "fog",
	heading: "apricot",
	literal: "lime",
	keyword: "plum",
	callable: "berry",
	type: "apricot",
	number: "apricot",
};

const every = (d: ReturnType<typeof derive>) => [
	...Object.entries(d.colors),
	...Object.entries(d.export),
];

describe("the rules are about structure, not about a palette", () => {
	const derived = derive(invented, inventedSemantics);

	it("derives a complete theme from a palette it has never seen", () => {
		assert.ok(Object.keys(derived.colors).length > 50, "suspiciously few tokens");
	});

	it("resolves every token against that palette", () => {
		for (const [token, value] of every(derived)) {
			assert.match(resolve(invented, value), /^#[0-9a-f]{6}$/, token);
		}
	});

	it("uses only roles the palette declares", () => {
		for (const [token, value] of every(derived)) {
			const names = "role" in value ? [value.role] : [value.over, value.tint];
			for (const name of names) assert.ok(invented.roles[name], `${token} names "${name}"`);
		}
	});

	it("still rises through the thinking levels on an unfamiliar palette", () => {
		const ramp = thinkingRamp(invented, inventedSemantics);
		const base = invented.roles.cellar!;
		const ratios = ramp.map((r) => contrast(resolve(invented, r), base));
		for (let i = 1; i < ratios.length; i += 1) {
			assert.ok(ratios[i]! > ratios[i - 1]!, `step ${i} falls back to ${ratios[i]!.toFixed(2)}`);
		}
	});

	it("says which palette is short rather than emitting a broken ramp", () => {
		const thin: Semantics = {
			...inventedSemantics,
			surfaces: ["cellar", "ground"],
			neutrals: ["clear"],
			decoration: "plum",
			link: "plum",
			comment: "plum",
			error: "plum",
			warning: "plum",
			success: "plum",
			info: "plum",
			heading: "plum",
			literal: "plum",
			keyword: "plum",
			callable: "plum",
			type: "plum",
			number: "plum",
		};
		assert.throws(() => thinkingRamp(invented, thin), /need 6 for a 7 step ramp/);
	});

	it("names a missing role rather than emitting undefined", () => {
		assert.throws(() => resolve(invented, { role: "basement" }), /has no role "basement"/);
	});
});

describe("the thinking ramp", () => {
	for (const palette of PALETTES) {
		const semantics = semanticsFor(palette);
		const base = palette.roles[semantics.surfaces[0]!]!;
		const ramp = thinkingRamp(palette, semantics);
		const ratios = ramp.map((r) => contrast(resolve(palette, r), base));

		it(`${palette.name} rises at every step`, () => {
			// pi keeps this on screen all session, so a lower level looking louder
			// than a higher one is the bug that started this.
			for (let i = 1; i < ratios.length; i += 1) {
				assert.ok(
					ratios[i]! > ratios[i - 1]!,
					`step ${i} is ${ratios[i]!.toFixed(1)}:1, below step ${i - 1} at ${ratios[i - 1]!.toFixed(1)}:1`,
				);
			}
		});

		it(`${palette.name} ends on the signature accent`, () => {
			assert.deepEqual(ramp.at(-1), { role: semantics.signature });
		});

		it(`${palette.name} never puts the palette's loudest colour on the border`, () => {
			// This is where gold ended up before, at the highest contrast rose-pine
			// has, on the one piece of chrome that is on screen all session.
			const loudest = Math.max(...Object.values(palette.roles).map((c) => contrast(c, base)));
			for (const at of ratios) {
				assert.ok(at < loudest, `a step sits at ${at.toFixed(1)}:1, the loudest in the palette`);
			}
		});

		it(`${palette.name} gives every level its own colour`, () => {
			const colours = ramp.map((step) => resolve(palette, step));
			assert.equal(new Set(colours).size, colours.length, "two levels share a colour");
		});

		it(`${palette.name} keeps the dimmest step visible`, () => {
			assert.ok(ratios[0]! >= BORDER_FLOOR, `off is ${ratios[0]!.toFixed(2)}:1, effectively no border`);
		});
	}
});

describe("varName", () => {
	it("keeps the upstream role name so provenance shows in the output", () => {
		assert.equal(varName({ role: "plum" }), "plum");
	});

	it("names a tint after both of its inputs", () => {
		assert.equal(varName({ over: "ground", tint: "lime" }), "limeOnGround");
	});

	it("gives different tints different names", () => {
		assert.notEqual(varName({ over: "ground", tint: "lime" }), varName({ over: "ground", tint: "cherry" }));
	});
});

describe("every colour is upstream", () => {
	for (const palette of PALETTES) {
		const semantics = semanticsFor(palette);
		const derived = derive(palette, semantics);
		const official = new Set(Object.values(palette.roles));

		it(`${palette.name} names only roles the palette defines`, () => {
			for (const role of rolesUsed(semantics)) {
				assert.ok(palette.roles[role], `semantics name "${role}", absent from ${palette.name}`);
			}
		});

		it(`${palette.name} uses palette values verbatim wherever it is not tinting`, () => {
			for (const [token, value] of every(derived)) {
				if (!("role" in value)) continue;
				assert.ok(official.has(resolve(palette, value)), `${token} resolved off palette`);
			}
		});

		it(`${palette.name} tints only by the published alpha, from two palette colours`, () => {
			const tints = every(derived).filter(([, value]) => !("role" in value));
			assert.ok(tints.length > 0, "expected at least one state-tinted surface");
			for (const [, value] of tints) {
				const tint = value as Extract<Ref, { over: string }>;
				assert.ok(official.has(palette.roles[tint.over]!), "tinted over a non-palette colour");
				assert.ok(official.has(palette.roles[tint.tint]!), "tinted with a non-palette colour");
			}
		});

		it(`${palette.name} uses the published alpha`, () => {
			// Both projects state 0.15; rose-pine writes it as #..26.
			assert.equal(STATE_TINT, 0.15);
			assert.equal(Math.round((0x26 / 255) * 100) / 100, STATE_TINT);
		});
	}
});
