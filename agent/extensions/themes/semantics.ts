// What a palette means, as opposed to what it is called.
//
// Every palette worth using describes the same handful of ideas in its own
// vocabulary: a ladder of surfaces, a ladder of foreground greys, and a set of
// accents with jobs. Naming those once per palette is what lets derive.ts build
// all 55 pi tokens by rule, so a new palette is 14 declarations rather than 55
// decisions, and cannot come out looking unlike the others.
//
// Assignments quote upstream wherever upstream states them:
//   rose-pine roles   https://github.com/rose-pine/palette#roles
//   catppuccin syntax https://github.com/catppuccin/catppuccin/blob/main/docs/style-guide.md

import type { Palette } from "./palettes.ts";

export type Semantics = {
	/**
	 * Backgrounds, darkest first. [0] is the one the theme assumes is behind it,
	 * since pi paints no background of its own.
	 */
	readonly surfaces: readonly string[];
	/** Foreground greys, dimmest first, ending at body text. */
	readonly neutrals: readonly string[];

	/**
	 * The accent that carries the palette's identity.
	 *
	 * Also what a document's own furniture is drawn in -- headings and list
	 * bullets. Those are structure rather than content, and structure is where
	 * a palette shows what it is. Links are not included: catppuccin cites blue
	 * for them, and rose-pine's signature being its link colour too is that
	 * palette's coincidence.
	 *
	 * Headings once had a declaration of their own, which meant picking a
	 * colour for something no palette describes: they describe code, and a
	 * heading is prose. The pick was wrong (rose-pine's was the warning
	 * colour), and replacing it with a better pick would have left the picking.
	 * Headings are bold already, and underlined at level one, so the colour was
	 * never carrying the signal alone.
	 */
	readonly signature: string;
	/** A second accent for decoration that must not read as a status. */
	/**
	 * Inline code, and whatever else is ornament rather than meaning.
	 *
	 * Also uncited: no palette names a colour for this. Taken as the warm or
	 * cool counterpart to the signature, so the two accents a page shows most
	 * often do not sit in the same part of the wheel.
	 */
	readonly decoration: string;

	readonly error: string;
	readonly warning: string;
	readonly success: string;
	/** Links and hints. */
	readonly link: string;
	/** Object keys and other "this is data" highlighting. */
	readonly info: string;
	/** Comments; upstream states this, so it is not read off the ladder. */
	readonly comment: string;

	/** Strings and other literals. */
	readonly literal: string;
	readonly keyword: string;
	readonly callable: string;
	readonly type: string;
	readonly number: string;
};

export const rosePineSemantics: Semantics = {
	// highlightLow is within a rounding step of surface, so it earns no rung.
	surfaces: ["base", "surface", "overlay", "highlightMed", "highlightHigh"],
	neutrals: ["muted", "subtle", "text"],

	signature: "iris", // "links, hints"; the colour the palette is known by
	decoration: "rose",

	error: "love", // "errors, git delete"
	warning: "gold", // "warnings"
	success: "foam", // "git add"
	link: "iris", // "links, hints"
	info: "foam", // "info, object keys"
	comment: "muted", // "comments"

	literal: "gold", // "strings"
	keyword: "pine", // from the vscode port
	callable: "pine", // "functions"
	type: "foam", // from the vscode port
	number: "rose", // from the vscode port
};

export const catppuccinSemantics: Semantics = {
	surfaces: ["base", "surface0", "surface1", "surface2"],
	neutrals: ["overlay0", "overlay1", "overlay2", "subtext0", "subtext1", "text"],

	signature: "mauve", // "Keyword"; the colour the palette is known by
	decoration: "teal",

	error: "red",
	warning: "yellow",
	success: "green",
	link: "blue",
	info: "blue", // "Property (e.g. JSON keys)"
	comment: "overlay2", // "Comments"

	literal: "green", // "Strings"
	keyword: "mauve", // "Keyword"
	callable: "blue", // "Methods, Functions"
	type: "yellow", // "Classes, Interfaces, Types"
	number: "peach", // "Constants, Numbers"
};

/** Palettes from the same project share a vocabulary; variants do not differ. */
export function semanticsFor(palette: Palette): Semantics {
	return palette.name.startsWith("rose-pine") ? rosePineSemantics : catppuccinSemantics;
}

/** Every role a Semantics names, for checking it against the palette. */
export function rolesUsed(semantics: Semantics): string[] {
	const { surfaces, neutrals, ...accents } = semantics;
	return [...surfaces, ...neutrals, ...Object.values(accents)];
}
