// Which palette role plays which pi token.
//
// A token is never given a colour directly. It names a role, or asks for one
// role tinted over another, and the palette supplies the value. That is what
// makes "strictly official" checkable rather than merely intended: there is no
// way to express an off-palette colour here, so mapping.test.ts can prove every
// emitted colour came from the upstream project.
//
// Where the upstream project states which role a use belongs to, the comment
// says so and the mapping follows it. The rest are choices, marked as such.
//
//   rose-pine roles   https://github.com/rose-pine/palette#roles
//   catppuccin syntax https://github.com/catppuccin/catppuccin/blob/main/docs/style-guide.md

import type { ThemeColor } from "@earendil-works/pi-coding-agent";

/** The published alpha for a state-tinted surface. See color.ts. */
export const STATE_TINT = 0.15;

/**
 * pi exports the foreground token union but not the background one, so the
 * background names are repeated here. contract.test.ts checks this list against
 * pi's schema, which is what catches it drifting.
 */
export type ThemeBgToken =
	| "selectedBg"
	| "scrollbarThumb"
	| "searchMatchBg"
	| "userMessageBg"
	| "customMessageBg"
	| "toolPendingBg"
	| "toolSuccessBg"
	| "toolErrorBg";

export type Token = ThemeColor | ThemeBgToken;

export type Ref =
	/** Use a palette role as-is. */
	| { readonly role: string }
	/**
	 * Composite `tint` over `over` at STATE_TINT, for a surface that carries state.
	 *
	 * `over` is the surface the block would otherwise have, not the page behind
	 * it. Tinting the page instead leaves the tinted and untinted blocks only
	 * ~20 apart on catppuccin, because the surface is lighter than the base and
	 * the two moves cancel. Tinting the surface keeps them 43+ apart.
	 */
	| { readonly over: string; readonly tint: string };

export type Mapping = Readonly<Record<Token, Ref>>;
export type ExportMapping = Readonly<Record<"pageBg" | "cardBg" | "infoBg", Ref>>;

/**
 * A whole theme's worth of refs.
 *
 * `colors` is a total Record over the token union rather than a Partial, so
 * forgetting a token is a compile error against pi's own type instead of a
 * runtime surprise at startup.
 *
 * `export` is optional in pi's schema and only affects HTML export, but it goes
 * through the same refs as everything else so the strictness proof covers it.
 * Writing it by hand is how the first version smuggled an undeclared colour in.
 */
export type ThemeMapping = {
	readonly colors: Mapping;
	readonly export: ExportMapping;
};

const role = (name: string): Ref => ({ role: name });
const tinted = (over: string, tint: string): Ref => ({ over, tint });

// ------------------------------------------------------------- rose-pine
// Quoted usages come from the role table in the palette README.

export const rosePineMapping: Mapping = {
	accent: role("iris"), // "links, hints"; also the signature colour
	border: role("highlightHigh"), // "borders"
	borderAccent: role("iris"),
	borderMuted: role("highlightMed"),
	success: role("foam"), // "git add, info"
	error: role("love"), // "errors, git delete"
	warning: role("gold"), // "warnings"
	muted: role("subtle"), // "medium contrast foreground"
	dim: role("muted"), // "low contrast foreground"
	text: role("text"),
	thinkingText: role("muted"),

	selectedBg: role("highlightMed"), // "selection background"
	scrollbarThumb: role("highlightHigh"),
	searchMatchBg: role("highlightMed"),
	searchMatchText: role("text"), // "selection foreground (paired with highlightMed)"
	userMessageBg: role("surface"), // "text inputs, panels"
	userMessageText: role("text"),
	customMessageBg: role("overlay"), // "panels, active tabs"
	customMessageText: role("text"),
	customMessageLabel: role("iris"),
	toolPendingBg: role("surface"),
	toolSuccessBg: tinted("surface", "foam"), // the port's insertedLineBackground
	toolErrorBg: tinted("surface", "love"), // the port's removedLineBackground
	toolTitle: role("text"),
	toolOutput: role("subtle"),

	mdHeading: role("gold"),
	mdLink: role("iris"), // "links"
	mdLinkUrl: role("muted"),
	mdCode: role("rose"),
	mdCodeBlock: role("text"),
	mdCodeBlockBorder: role("highlightMed"),
	mdQuote: role("subtle"),
	mdQuoteBorder: role("muted"),
	mdHr: role("muted"),
	mdListBullet: role("iris"),

	toolDiffAdded: role("foam"), // "git add"
	toolDiffRemoved: role("love"), // "git delete"
	toolDiffContext: role("muted"),

	syntaxComment: role("muted"), // "comments"
	syntaxKeyword: role("pine"), // from the vscode port
	syntaxFunction: role("pine"), // "functions"
	syntaxVariable: role("text"), // "variables"
	syntaxString: role("gold"), // "strings"
	syntaxNumber: role("rose"), // from the vscode port
	syntaxType: role("foam"), // from the vscode port
	syntaxOperator: role("subtle"), // "operators"
	syntaxPunctuation: role("subtle"), // "punctuation"

	// Thinking levels are pi's editor border, not a badge: the level you run at
	// is on screen the whole session. So the ramp walks neutral, cool, warm and
	// lands on the palette's signature, rather than ending on whatever is
	// loudest. gold is deliberately absent — it has the highest contrast against
	// base of any rose-pine colour, which is what you want for a warning and not
	// what you want around your input for eight hours.
	thinkingOff: role("muted"),
	thinkingMinimal: role("subtle"),
	thinkingLow: role("pine"),
	thinkingMedium: role("foam"),
	thinkingHigh: role("rose"),
	thinkingXhigh: role("love"),
	thinkingMax: role("iris"),

	bashMode: role("foam"),
};

export const rosePineExport: ExportMapping = {
	pageBg: role("base"),
	cardBg: role("surface"),
	infoBg: tinted("base", "gold"),
};

// ------------------------------------------------------------ catppuccin
// Quoted usages come from the Syntax Colors table in the style guide.

export const catppuccinMapping: Mapping = {
	accent: role("mauve"), // "Keyword"; also the signature colour
	border: role("surface2"),
	borderAccent: role("mauve"),
	borderMuted: role("surface1"),
	success: role("green"),
	error: role("red"),
	warning: role("yellow"),
	muted: role("subtext0"),
	dim: role("overlay0"),
	text: role("text"),
	thinkingText: role("overlay1"),

	selectedBg: role("surface1"),
	scrollbarThumb: role("surface2"),
	searchMatchBg: role("surface1"),
	searchMatchText: role("text"),
	userMessageBg: role("surface0"),
	userMessageText: role("text"),
	customMessageBg: role("mantle"),
	customMessageText: role("text"),
	customMessageLabel: role("mauve"),
	toolPendingBg: role("surface0"),
	toolSuccessBg: tinted("surface0", "green"), // the port's insertedLineBackground
	toolErrorBg: tinted("surface0", "red"), // the port's removedLineBackground
	toolTitle: role("text"),
	toolOutput: role("subtext0"),

	mdHeading: role("peach"),
	mdLink: role("blue"),
	mdLinkUrl: role("overlay1"),
	mdCode: role("teal"),
	mdCodeBlock: role("text"),
	mdCodeBlockBorder: role("surface2"),
	mdQuote: role("subtext0"),
	mdQuoteBorder: role("overlay0"),
	mdHr: role("surface2"),
	mdListBullet: role("mauve"),

	toolDiffAdded: role("green"),
	toolDiffRemoved: role("red"),
	toolDiffContext: role("overlay1"),

	syntaxComment: role("overlay2"), // "Comments"
	syntaxKeyword: role("mauve"), // "Keyword"
	syntaxFunction: role("blue"), // "Methods, Functions"
	syntaxVariable: role("text"),
	syntaxString: role("green"), // "Strings"
	syntaxNumber: role("peach"), // "Constants, Numbers"
	syntaxType: role("yellow"), // "Classes, Interfaces, Types"
	syntaxOperator: role("sky"), // "Operators"
	syntaxPunctuation: role("overlay2"),

	// Same shape as rose-pine: neutral, cool, warm, then the signature. See there.
	thinkingOff: role("overlay0"),
	thinkingMinimal: role("overlay1"),
	thinkingLow: role("teal"),
	thinkingMedium: role("blue"),
	thinkingHigh: role("pink"),
	thinkingXhigh: role("red"),
	thinkingMax: role("mauve"),

	bashMode: role("green"),
};

export const catppuccinExport: ExportMapping = {
	pageBg: role("base"),
	cardBg: role("mantle"),
	infoBg: tinted("base", "yellow"),
};

/** rose-pine and catppuccin name their roles differently, so each has its own map. */
export function mappingFor(paletteName: string): ThemeMapping {
	return paletteName.startsWith("rose-pine")
		? { colors: rosePineMapping, export: rosePineExport }
		: { colors: catppuccinMapping, export: catppuccinExport };
}
