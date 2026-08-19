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

export interface FooterState {
	modelId: string;
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
	home: string;
}

export const EMPTY_STATE: FooterState = {
	modelId: "no-model",
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
	home: "",
};

/** Default relative importance. Higher survives longer when space runs out. */
export const DEFAULT_PRIORITY: Record<string, number> = {
	ctx: 10,
	model: 9,
	cost: 8,
	hit: 7,
	in: 6,
	out: 6,
	cache: 5,
	cwd: 3,
};

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

	return (barCells: number): Segment[] => {
		const raw: Segment[] = [
			{ id: "model", text: `${state.modelId} · think ${state.thinkingLevel}`, color: "accent", priority: 0 },
			{
				id: "ctx",
				text: `ctx ${progressBar(state.contextPercent ?? 0, barCells)} ${pctText} ${ctxNums}`,
				color: ctxColor,
				priority: 0,
			},
			{ id: "in", text: `in ${formatCount(state.input)}`, color: "muted", priority: 0 },
			{ id: "out", text: `out ${formatCount(state.output)}`, color: "muted", priority: 0 },
			{
				id: "cache",
				text: `cache ${formatCount(state.cacheRead)}/${formatCount(state.cacheWrite)}`,
				color: "muted",
				priority: 0,
			},
			{ id: "hit", text: `hit ${hitText}`, color: "muted", priority: 0 },
			{ id: "cost", text: costText, color: "dim", priority: 0 },
			{ id: "cwd", text: state.branch ? `${cwdText} (${state.branch})` : cwdText, color: "dim", priority: 0 },
		];

		return raw
			.filter((s) => !cfg.hide.includes(s.id) && s.text.trim().length > 0)
			.map((s) => ({ ...s, priority: cfg.priority[s.id] ?? DEFAULT_PRIORITY[s.id] ?? 0 }));
	};
}
