/**
 * Contracts with pi that the type system cannot express.
 *
 * Run: pnpm test
 *
 * Themes are data pi reads, not code it calls, so the only thing keeping them
 * valid is pi's own schema. That schema is read from the installed pi rather
 * than copied here, so a pi that adds, renames or drops a token fails this file
 * instead of failing silently at startup.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { getPackageDir } from "@earendil-works/pi-coding-agent";

import { buildTheme, render } from "./build.ts";
import { mappingFor } from "./mapping.ts";
import { contrast, difference } from "./color.ts";
import { PALETTES } from "./palettes.ts";

type Schema = {
	properties: {
		colors: {
			required: string[];
			properties: Record<string, unknown>;
			additionalProperties: boolean;
		};
	};
};

// package.json is not in pi's exports map, so the package directory is the way in.
const THEME_DIR = join(getPackageDir(), "dist/modes/interactive/theme");
const SCHEMA_PATH = join(THEME_DIR, "theme-schema.json");
const schema: Schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf-8"));
const colors = schema.properties.colors;

/**
 * How far apart pi's own dark theme keeps its three tool backgrounds.
 *
 * Read rather than hardcoded so the bar is "at least as legible as what pi
 * ships", which is a claim about pi, not a number someone picked. If pi retunes
 * its theme the bar moves with it.
 */
function builtInStateSeparation(): number {
	const dark = JSON.parse(readFileSync(join(THEME_DIR, "dark.json"), "utf-8")) as {
		vars: Record<string, string>;
		colors: Record<string, string>;
	};
	const value = (token: string) => {
		const ref = dark.colors[token]!;
		return dark.vars[ref] ?? ref;
	};
	const [ok, err, pending] = ["toolSuccessBg", "toolErrorBg", "toolPendingBg"].map(value) as [
		string,
		string,
		string,
	];
	return Math.min(difference(ok, err), difference(ok, pending), difference(err, pending));
}

const BUILT_IN_SEPARATION = builtInStateSeparation();

describe("pi's theme schema", () => {
	it("is where we expect it in the installed pi", () => {
		assert.ok(colors.required.length > 0, `no required tokens in ${SCHEMA_PATH}`);
	});

	it("still refuses unknown tokens, which is what makes the extra-token check meaningful", () => {
		assert.equal(colors.additionalProperties, false);
	});

	it("agrees with the token union the mapping is typed against", () => {
		// tsc already proves the mapping covers every ThemeColor pi exports, but pi
		// does not export ThemeBg, so the background half is only as right as the
		// hand-written union in mapping.ts. This is the half that can drift.
		const mapped = Object.keys(mappingFor("rose-pine").colors).sort();
		const known = Object.keys(colors.properties).sort();
		assert.deepEqual(mapped, known, "the mapping and pi's schema list different tokens");
	});
});

describe("generated themes", () => {
	for (const palette of PALETTES) {
		describe(palette.name, () => {
			const theme = buildTheme(palette);

			it("defines every token pi requires", () => {
				const missing = colors.required.filter((token) => !(token in theme.colors));
				assert.deepEqual(missing, [], `pi requires tokens this theme does not set`);
			});

			it("defines no token pi would reject", () => {
				const unknown = Object.keys(theme.colors).filter((token) => !(token in colors.properties));
				assert.deepEqual(unknown, [], "pi's schema forbids unknown tokens");
			});

			it("points every token at a variable it declares", () => {
				for (const [token, name] of Object.entries(theme.colors)) {
					assert.ok(theme.vars[name], `${token} refers to undeclared var "${name}"`);
				}
			});

			it("declares no unused variable", () => {
				const used = new Set(Object.values(theme.colors));
				const unused = Object.keys(theme.vars).filter((name) => !used.has(name));
				assert.deepEqual(unused, [], "dead entries in vars");
			});

			it("writes hex colours pi can parse", () => {
				for (const [name, value] of Object.entries({ ...theme.vars, ...theme.export })) {
					assert.match(value, /^#[0-9a-f]{6}$/, `var ${name}`);
				}
			});

			it("round trips through JSON unchanged", () => {
				assert.deepEqual(JSON.parse(render(theme)), theme);
			});
		});
	}
});

describe("readability", () => {
	// pi has no background token: the terminal's own background shows through.
	// These check the palette against its own base, which is the background the
	// theme is designed for and what README tells you to set the terminal to.
	for (const palette of PALETTES) {
		const theme = buildTheme(palette);
		const base = palette.roles.base!;
		const value = (token: string) => theme.vars[theme.colors[token]!]!;

		it(`${palette.name} keeps body text readable on its own base`, () => {
			const ratio = contrast(value("text"), base);
			assert.ok(ratio >= 7, `text on base is ${ratio.toFixed(1)}:1, below the 7:1 AAA bar`);
		});

		it(`${palette.name} keeps secondary text legible`, () => {
			for (const token of ["muted", "toolOutput", "thinkingText"]) {
				const ratio = contrast(value(token), base);
				assert.ok(ratio >= 3, `${token} on base is ${ratio.toFixed(1)}:1, below 3:1`);
			}
		});

		it(`${palette.name} keeps tool text readable on its tinted background`, () => {
			for (const [text, bg] of [
				["toolTitle", "toolSuccessBg"],
				["toolTitle", "toolErrorBg"],
				["toolOutput", "toolSuccessBg"],
				["toolOutput", "toolErrorBg"],
			] as const) {
				const ratio = contrast(value(text), value(bg));
				assert.ok(ratio >= 3, `${text} on ${bg} is ${ratio.toFixed(1)}:1, below 3:1`);
			}
		});

		it(`${palette.name} does not put its loudest colour around the input`, () => {
			// pi paints the editor border with the thinking level, so whichever
			// level you run at is on screen all session. An earlier version put
			// gold there, which is the highest-contrast colour rose-pine has.
			const ramp = ["thinkingLow", "thinkingMedium", "thinkingHigh", "thinkingXhigh", "thinkingMax"];
			const loudest = Math.max(...Object.values(palette.roles).map((c) => contrast(c, base)));
			for (const token of ramp) {
				const ratio = contrast(value(token), base);
				assert.ok(
					ratio < loudest,
					`${token} is the loudest colour in the palette at ${ratio.toFixed(1)}:1 against base`,
				);
			}
		});

		it(`${palette.name} keeps every thinking level tellable from its neighbours`, () => {
			const ramp = [
				"thinkingOff",
				"thinkingMinimal",
				"thinkingLow",
				"thinkingMedium",
				"thinkingHigh",
				"thinkingXhigh",
				"thinkingMax",
			];
			const seen = new Map<string, string>();
			for (const token of ramp) {
				const colour = value(token);
				const clash = seen.get(colour);
				assert.ok(!clash, `${token} and ${clash} are both ${colour}`);
				seen.set(colour, token);
			}
		});

		it(`${palette.name} separates its state backgrounds from each other and the neutral one`, () => {
			// Contrast ratio cannot see this: a red and a blue surface of equal
			// lightness score 1.0 while looking nothing alike.
			const pairs = [
				["toolSuccessBg", "toolErrorBg"],
				["toolSuccessBg", "toolPendingBg"],
				["toolErrorBg", "toolPendingBg"],
			] as const;
			for (const [a, b] of pairs) {
				const d = difference(value(a), value(b));
				assert.ok(
					d >= BUILT_IN_SEPARATION,
					`${a} and ${b} differ by ${d.toFixed(1)}, less than the ${BUILT_IN_SEPARATION.toFixed(1)} pi's own dark theme manages`,
				);
			}
		});
	}
});
