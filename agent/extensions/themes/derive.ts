// The rules that turn a palette's semantics into pi's 55 tokens.
//
// Nothing here names a colour, a role, or a palette. Everything is expressed as
// a position on one of the two ladders or one of the named accents, so the same
// rules produce a coherent theme from any palette that can describe itself.
// derive.test.ts checks that by deriving a theme from a synthetic palette whose
// roles are named nothing like rose-pine's or catppuccin's.

import { composite, contrast, luminance } from "./color.ts";
import type { Palette } from "./palettes.ts";
import type { Semantics } from "./semantics.ts";

/** The published alpha for a state-tinted surface. See color.ts. */
export const STATE_TINT = 0.15;

/**
 * The dimmest a thinking level border may be against the page.
 *
 * Below roughly this the input has no visible frame at all, which is a
 * regression for anyone running with thinking off rather than a subtle look.
 * pi's own dark theme puts its dimmest level at 2.19:1, which contract.test.ts
 * checks this against.
 */
export const BORDER_FLOOR = 1.5;

/** pi exports ThemeColor but not the background half of its token union. */
export type ThemeBgToken =
	| "selectedBg"
	| "scrollbarThumb"
	| "searchMatchBg"
	| "userMessageBg"
	| "customMessageBg"
	| "toolPendingBg"
	| "toolSuccessBg"
	| "toolErrorBg";

export type Ref =
	/** Use a palette role as-is. */
	| { readonly role: string }
	/**
	 * Composite `tint` over `over` at STATE_TINT.
	 *
	 * `over` is the surface the block would otherwise have, not the page behind
	 * it. Tinting the page instead leaves tinted and untinted blocks only ~20
	 * apart wherever the surface is much lighter than the base, because the two
	 * moves cancel.
	 */
	| { readonly over: string; readonly tint: string };

const ref = (role: string): Ref => ({ role });

/** Read a rung, counting from the end for negative indices. */
function rung(ladder: readonly string[], index: number, what: string): string {
	const role = index < 0 ? ladder.at(index) : ladder[index];
	if (!role) throw new Error(`${what}: ladder of ${ladder.length} has no rung ${index}`);
	return role;
}

/**
 * How readable pi's own dark theme makes each tier of foreground text.
 *
 * Ladders differ in length — rose-pine names three foreground greys, catppuccin
 * six — so reading them by index gives a "dim" that is genuinely dim on one
 * palette and almost body text on another. Picking the rung nearest a target
 * instead makes the tiers land in the same place whatever the palette, and
 * anchoring the targets to pi means "as readable as what pi ships" rather than
 * numbers someone liked. contract.test.ts checks them against pi.
 */
export const FOREGROUND_TIERS = { body: 11.9, secondary: 4.5, tertiary: 3.1 } as const;

/** WCAG's floor for text that still has to be read. */
export const LEGIBLE = 3;

/**
 * The rung whose contrast against `behind` sits closest to a target.
 *
 * `behind` matters: tool output sits on a panel rather than on the page, and a
 * grey chosen to be 4.5:1 against the page is only 2.3:1 against a panel three
 * steps lighter, which is where it stops being readable.
 */
function nearest(palette: Palette, ladder: readonly string[], behind: string, target: number): string {
	let best = ladder[0]!;
	let bestGap = Infinity;
	for (const role of ladder) {
		const gap = Math.abs(contrast(palette.roles[role]!, behind) - target);
		if (gap < bestGap) [best, bestGap] = [role, gap];
	}
	return best;
}

/**
 * The thinking level border, which pi keeps on screen for the whole session.
 *
 * It climbs by measured contrast and lands on the signature accent, so the
 * level reads as how present the frame is, and the top of the ramp is the
 * palette's identity rather than whatever happens to be loudest. Choosing by
 * measurement rather than by name is what keeps it rising on a palette nobody
 * has looked at yet.
 *
 * A border is chrome, so the steps come from the palette's neutrals wherever
 * there are enough of them. Accents are pulled in only to make up the numbers,
 * nearest the signature first: rose-pine's neutrals offer four rungs above the
 * visibility floor, which is two short. Status accents are not excluded — pi
 * itself borders bash mode with its success colour.
 */
export function thinkingRamp(palette: Palette, semantics: Semantics, steps = 7): Ref[] {
	const base = palette.roles[rung(semantics.surfaces, 0, "surfaces")]!;
	const ceiling = contrast(palette.roles[semantics.signature]!, base);
	const below = steps - 1;

	const { surfaces, neutrals, ...accents } = semantics;
	const seen = new Set<string>();
	const usable = (roles: readonly string[]) =>
		roles
			.map((role) => ({ role, colour: palette.roles[role]!, at: contrast(palette.roles[role]!, base) }))
			.filter((step) => step.at >= BORDER_FLOOR && step.at < ceiling)
			.sort((a, b) => a.at - b.at)
			// Two rungs of the same colour would read as one step.
			.filter((step) => !seen.has(step.colour) && seen.add(step.colour));

	const grey = usable([...surfaces.slice(1), ...neutrals]);
	const colourful = usable(Object.values(accents));
	const filler = colourful.slice(Math.max(0, colourful.length - (below - grey.length)));
	const ladder = [...grey, ...filler].sort((a, b) => a.at - b.at);

	if (ladder.length < below) {
		throw new Error(
			`${palette.name}: ${ladder.length} steps between ${BORDER_FLOOR}:1 and ${semantics.signature}, need ${below} for a ${steps} step ramp`,
		);
	}
	const picked = Array.from({ length: below }, (_, i) =>
		ref(ladder[Math.round((i * (ladder.length - 1)) / (below - 1))]!.role),
	);
	return [...picked, ref(semantics.signature)];
}

/** The dimmest rung that still clears a floor, or the brightest if none does. */
function atLeast(palette: Palette, ladder: readonly string[], behind: string, floor: number): string {
	const rungs = ladder
		.map((role) => ({ role, at: contrast(palette.roles[role]!, behind) }))
		.sort((a, b) => a.at - b.at);
	return (rungs.find((step) => step.at >= floor) ?? rungs.at(-1)!).role;
}

export type Derived = {
	readonly colors: Readonly<Record<string, Ref>>;
	readonly export: Readonly<Record<string, Ref>>;
};

export function derive(palette: Palette, semantics: Semantics): Derived {
	const { surfaces, neutrals } = semantics;
	// Ladder positions, named for what the rung is for rather than its index.
	const page = rung(surfaces, 0, "surfaces");
	const panel = rung(surfaces, 1, "surfaces");
	const raised = rung(surfaces, 2, "surfaces");
	const edge = rung(surfaces, -1, "surfaces");
	const softEdge = rung(surfaces, -2, "surfaces");

	// Body text is the top of the ladder by definition; the dimmer tiers are the
	// rungs that land nearest pi's own, so they read the same on any palette.
	const body = rung(neutrals, -1, "neutrals");
	const dimmer = neutrals.slice(0, -1);
	const onPage = (target: number) => nearest(palette, dimmer, palette.roles[page]!, target);
	// Tool output sits on a panel that state tinting makes lighter still, so it
	// is picked against the brightest of those rather than against the page, and
	// against a floor rather than a target: nearest-to-4.5 can land at 2.9.
	const panels = [
		palette.roles[panel]!,
		composite(palette.roles[panel]!, palette.roles[semantics.success]!, STATE_TINT),
		composite(palette.roles[panel]!, palette.roles[semantics.error]!, STATE_TINT),
	];
	const worstPanel = panels.reduce((a, b) => (luminance(a) > luminance(b) ? a : b));
	const onPanel = (floor: number) => atLeast(palette, [...dimmer, body], worstPanel, floor);
	const secondary = onPage(FOREGROUND_TIERS.secondary);
	const tertiary = onPage(FOREGROUND_TIERS.tertiary);

	const [off, minimal, low, medium, high, xhigh, max] = thinkingRamp(palette, semantics) as [
		Ref,
		Ref,
		Ref,
		Ref,
		Ref,
		Ref,
		Ref,
	];

	return {
		colors: {
			accent: ref(semantics.signature),
			border: ref(edge),
			borderAccent: ref(semantics.signature),
			borderMuted: ref(softEdge),
			success: ref(semantics.success),
			error: ref(semantics.error),
			warning: ref(semantics.warning),
			muted: ref(secondary),
			dim: ref(tertiary),
			text: ref(body),
			thinkingText: ref(secondary),

			selectedBg: ref(raised),
			scrollbarThumb: ref(edge),
			searchMatchBg: ref(raised),
			searchMatchText: ref(body),
			userMessageBg: ref(panel),
			userMessageText: ref(body),
			customMessageBg: ref(raised),
			customMessageText: ref(body),
			customMessageLabel: ref(semantics.signature),
			toolPendingBg: ref(panel),
			toolSuccessBg: { over: panel, tint: semantics.success },
			toolErrorBg: { over: panel, tint: semantics.error },
			toolTitle: ref(body),
			toolOutput: ref(onPanel(LEGIBLE)),

			mdHeading: ref(semantics.signature),
			mdLink: ref(semantics.link),
			mdLinkUrl: ref(tertiary),
			mdCode: ref(semantics.decoration),
			mdCodeBlock: ref(body),
			mdCodeBlockBorder: ref(tertiary),
			mdQuote: ref(secondary),
			mdQuoteBorder: ref(tertiary),
			mdHr: ref(tertiary),
			mdListBullet: ref(semantics.signature),

			toolDiffAdded: ref(semantics.success),
			toolDiffRemoved: ref(semantics.error),
			toolDiffContext: ref(tertiary),

			syntaxComment: ref(semantics.comment),
			syntaxKeyword: ref(semantics.keyword),
			syntaxFunction: ref(semantics.callable),
			syntaxVariable: ref(body),
			syntaxString: ref(semantics.literal),
			syntaxNumber: ref(semantics.number),
			syntaxType: ref(semantics.type),
			syntaxOperator: ref(secondary),
			syntaxPunctuation: ref(secondary),

			thinkingOff: off,
			thinkingMinimal: minimal,
			thinkingLow: low,
			thinkingMedium: medium,
			thinkingHigh: high,
			thinkingXhigh: xhigh,
			thinkingMax: max,

			bashMode: ref(semantics.success),
		},
		export: {
			pageBg: ref(page),
			cardBg: ref(panel),
			infoBg: { over: panel, tint: semantics.warning },
		},
	};
}

/** Resolve a ref against a palette, failing loudly rather than emitting undefined. */
export function resolve(palette: Palette, value: Ref): string {
	const look = (role: string) => {
		const colour = palette.roles[role];
		if (!colour) throw new Error(`${palette.name} has no role "${role}"`);
		return colour;
	};
	if ("role" in value) return look(value.role);
	return composite(look(value.over), look(value.tint), STATE_TINT);
}

/** The variable name a ref is stored under, so provenance shows in the output. */
export function varName(value: Ref): string {
	if ("role" in value) return value.role;
	return `${value.tint}On${value.over[0]!.toUpperCase()}${value.over.slice(1)}`;
}
