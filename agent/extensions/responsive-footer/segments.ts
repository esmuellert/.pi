/**
 * Segment construction.
 *
 * Takes a plain snapshot of session state (no pi types) and turns it into the
 * ordered segment list. Order is fixed on purpose: greedy flow is already
 * line-count optimal for a fixed order, and reordering to squeeze out a few
 * cells would make fields jump around on every resize. Priority therefore
 * decides only what gets omitted, never what gets shortened or reordered.
 */

import { formatCount, progressBar, shortenHome } from "./format.ts";
import type { FooterConfig } from "./config.ts";
import type { Segment, SegmentBuilder } from "./layout.ts";

/**
 * Nerd Font glyphs. Only used where the icon is unambiguous by convention:
 * a folder, a git branch, a database. Metric fields keep their written labels,
 * because there is no shared visual vocabulary for "input tokens" and an icon
 * there would be guesswork.
 *
 * pi-tui measures these as one column. Set `icons: false` if your font lacks
 * them or your terminal renders them double-width.
 */
export const ICON = {
	folder: "\uF07B",
	branch: "\uE0A0",
	cache: "\uF1C0",
} as const;

export interface FooterState {
	modelId: string;
	provider: string;
	thinkingLevel: string;
	contextPercent: number | null;
	contextTokens: number | null;
	contextWindow: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	hitRate: number | null;
	usingSubscription: boolean;
	cwd: string;
	branch: string | null;
	sessionName: string | null;
	queued: boolean;
	home: string;
}

export const EMPTY_STATE: FooterState = {
	modelId: "no-model",
	provider: "",
	thinkingLevel: "off",
	contextPercent: null,
	contextTokens: null,
	contextWindow: 0,
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	cost: 0,
	hitRate: null,
	usingSubscription: false,
	cwd: "/",
	branch: null,
	sessionName: null,
	queued: false,
	home: "",
};

/** Extra context that most sessions do not need on screen. */
export const DEFAULT_HIDDEN = ["session", "provider", "queue"];

export function contextColor(percent: number | null, cfg: FooterConfig): string {
	if (percent === null) return "muted";
	if (percent >= cfg.ctxDanger) return "error";
	if (percent >= cfg.ctxWarn) return "warning";
	return "success";
}

/**
 * Returns a builder so the layout engine can re-render at different bar widths
 * while every other segment stays byte-identical.
 */
export function makeBuilder(state: FooterState, cfg: FooterConfig): SegmentBuilder {
	const pctText = state.contextPercent === null ? "?" : `${state.contextPercent.toFixed(0)}%`;
	const ctxNums =
		state.contextTokens === null
			? `?/${formatCount(state.contextWindow)}`
			: `${formatCount(state.contextTokens)}/${formatCount(state.contextWindow)}`;
	const hitText = state.hitRate === null ? "—" : `${state.hitRate.toFixed(0)}%`;
	const costText = `$${state.cost.toFixed(3)}${state.usingSubscription ? " sub" : ""}`;
	const cwdText = shortenHome(state.cwd, state.home);
	const ctxColor = contextColor(state.contextPercent, cfg);
	const folder = cfg.icons ? `${ICON.folder} ${cwdText}` : cwdText;
	const place = state.branch
		? cfg.icons
			? `${folder}  ${ICON.branch} ${state.branch}`
			: `${cwdText} (${state.branch})`
		: folder;
	const cacheText = `${formatCount(state.cacheRead)}/${formatCount(state.cacheWrite)}`;
	const cache = cfg.icons ? `${ICON.cache} ${cacheText}` : `cache ${cacheText}`;

	return (barCells: number): Segment[] => {
		// Display order is by stability: left-aligned text means a field that
		// changes width pushes everything to its right, so the fields that rarely
		// change lead and the per-turn counters trail.
		const raw: Segment[] = [
			{ id: "cwd", text: place, color: "dim" },
			{ id: "session", text: state.sessionName ? `session ${state.sessionName}` : "", color: "dim" },
			{ id: "model", text: `${state.modelId} · ${state.thinkingLevel}`, color: "accent" },
			{ id: "provider", text: state.provider ? `via ${state.provider}` : "", color: "dim" },
			{
				id: "ctx",
				text: `ctx ${progressBar(state.contextPercent ?? 0, barCells)} ${pctText} ${ctxNums}`,
				color: ctxColor
			},
			{ id: "queue", text: state.queued ? "queued" : "", color: "warning" },
			{ id: "in", text: `in ${formatCount(state.input)}`, color: "muted" },
			{ id: "out", text: `out ${formatCount(state.output)}`, color: "muted" },
			{
				id: "cache",
				text: cache,
				color: "muted"
			},
			{ id: "hit", text: `hit ${hitText}`, color: "muted" },
			{ id: "cost", text: costText, color: "dim" },
		];

		return raw.filter((s) => !cfg.hide.includes(s.id) && s.text.trim().length > 0);
	};
}
