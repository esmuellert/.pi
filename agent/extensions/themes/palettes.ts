// The palettes, taken from upstream at build time rather than copied here.
//
// This is what makes "strictly official" a property of the build instead of a
// promise in a comment: the colours arrive from @rose-pine/palette and
// @catppuccin/palette, so there is no transcription step to get wrong, and the
// versions are pinned in the workspace catalog and recorded in the lockfile.
//
// The two publish different shapes, and notably disagree about whether a hex
// string carries its "#", so everything is normalised here and checked in
// palettes.test.ts.

import { flavors } from "@catppuccin/palette";
import { variants } from "@rose-pine/palette";

export type Palette = {
	readonly name: string;
	readonly note: string;
	/** Upstream role name to #rrggbb. */
	readonly roles: Readonly<Record<string, string>>;
};

/** Upstream is inconsistent about the leading "#", so neither form is trusted. */
export function normaliseHex(value: string, context: string): string {
	const hex = value.startsWith("#") ? value : `#${value}`;
	if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`${context}: unusable hex ${JSON.stringify(value)}`);
	return hex.toLowerCase();
}

function fromRosePine(key: "main" | "moon", note: string): Palette {
	const variant = variants[key];
	const roles: Record<string, string> = {};
	for (const [role, colour] of Object.entries(variant.colors)) {
		roles[role] = normaliseHex(colour.hex, `rose-pine ${key}.${role}`);
	}
	// Upstream already names the variant: main is "rose-pine", moon is
	// "rose-pine-moon". Appending the key again would give rose-pine-moon-moon.
	return { name: variant.id, note, roles };
}

function fromCatppuccin(key: "frappe" | "macchiato" | "mocha", note: string): Palette {
	const flavor = flavors[key];
	const roles: Record<string, string> = {};
	for (const [role, colour] of Object.entries(flavor.colors)) {
		roles[role] = normaliseHex(colour.hex, `catppuccin ${key}.${role}`);
	}
	return { name: `catppuccin-${key}`, note, roles };
}

export const rosePine = fromRosePine("main", "darkest and most purple; the lowest saturation of the set");
export const rosePineMoon = fromRosePine("moon", "the same hues over a lighter base, for brighter rooms");
export const catppuccinFrappe = fromCatppuccin("frappe", "the softest catppuccin, close to rose-pine in saturation");
export const catppuccinMacchiato = fromCatppuccin("macchiato", "a middle catppuccin, a little more colour than frappe");
export const catppuccinMocha = fromCatppuccin("mocha", "the popular one; darkest base, brightest accents");

export const PALETTES: readonly Palette[] = [
	rosePine,
	rosePineMoon,
	catppuccinFrappe,
	catppuccinMacchiato,
	catppuccinMocha,
];
