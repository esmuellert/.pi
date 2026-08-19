/**
 * Responsive Footer
 *
 * Design rule: never trade readability for width. Labels are always spelled
 * out ("cache 29.5M/1.4M", never "c29M") at every terminal size. A narrow
 * terminal is short on columns but rich in rows, so the layout degrades by
 * wrapping and, only as a last resort, by omitting low-priority segments.
 *
 * Elasticity, in the order it is applied:
 *   1. line count      - segments flow and wrap like words in a paragraph
 *   2. context bar     - grows into leftover space while the line count holds
 *   3. justification   - remaining slack is shared between gaps, capped so it
 *                        never turns into a scatter of lonely words
 *   4. omission        - if the line budget is exceeded, the lowest-priority
 *                        segments are dropped entirely rather than abbreviated
 *
 * Because wording is fixed, resizing only ever changes wrapping, so the layout
 * moves in single-line steps instead of reshuffling every field at once.
 *
 * Optional config: ~/.pi/agent/footer.json
 *   {
 *     "maxLines": 6,
 *     "hide": ["provider", "session"],
 *     "priority": { "cwd": 1 },
 *     "ctxWarn": 65,
 *     "ctxDanger": 85,
 *     "separator": "  ",
 *     "maxGap": 4
 *   }
 *
 * /footer toggles back to the built-in footer.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

interface Config {
	maxLines: number;
	hide: string[];
	priority: Record<string, number>;
	ctxWarn: number;
	ctxDanger: number;
	separator: string;
	maxGap: number;
}

const DEFAULTS: Config = {
	maxLines: 6,
	hide: [],
	priority: {},
	ctxWarn: 65,
	ctxDanger: 85,
	separator: "  ",
	maxGap: 4,
};

function loadConfig(): Config {
	const path = join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "footer.json");
	if (!existsSync(path)) return DEFAULTS;
	try {
		const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<Config>;
		return {
			maxLines: typeof raw.maxLines === "number" ? Math.max(1, raw.maxLines) : DEFAULTS.maxLines,
			hide: Array.isArray(raw.hide) ? raw.hide.map(String) : DEFAULTS.hide,
			priority: raw.priority && typeof raw.priority === "object" ? raw.priority : DEFAULTS.priority,
			ctxWarn: typeof raw.ctxWarn === "number" ? raw.ctxWarn : DEFAULTS.ctxWarn,
			ctxDanger: typeof raw.ctxDanger === "number" ? raw.ctxDanger : DEFAULTS.ctxDanger,
			separator: typeof raw.separator === "string" && raw.separator.length > 0 ? raw.separator : DEFAULTS.separator,
			maxGap: typeof raw.maxGap === "number" ? Math.max(0, raw.maxGap) : DEFAULTS.maxGap,
		};
	} catch {
		// A broken config must never take the footer down.
		return DEFAULTS;
	}
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const fmt = (n: number): string => {
	if (!Number.isFinite(n)) return "—";
	if (n < 1000) return `${n}`;
	if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(1)}M`;
};

function bar(percent: number, cells: number): string {
	const filled = clamp(Math.round((percent / 100) * cells), 0, cells);
	return "▓".repeat(filled) + "░".repeat(cells - filled);
}

interface Totals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	hit: number | null;
}

function collect(ctx: ExtensionContext): Totals {
	const t: Totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, hit: null };
	for (const e of ctx.sessionManager.getBranch()) {
		let u: any;
		if (e.type === "message" && e.message.role === "assistant") u = (e.message as AssistantMessage).usage;
		else if (e.type === "message" && e.message.role === "toolResult") u = (e.message as any).usage;
		else if (e.type === "branch_summary" || e.type === "compaction") u = (e as any).usage;
		if (!u) continue;
		t.input += u.input ?? 0;
		t.output += u.output ?? 0;
		t.cacheRead += u.cacheRead ?? 0;
		t.cacheWrite += u.cacheWrite ?? 0;
		t.cost += u.cost?.total ?? 0;
		const denom = (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
		if (denom > 0) t.hit = ((u.cacheRead ?? 0) / denom) * 100;
	}
	return t;
}

function shortHome(p: string): string {
	const home = homedir();
	return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

interface Segment {
	id: string;
	text: string;
	color: string;
	priority: number;
}

export default function (pi: ExtensionAPI) {
	let enabled = true;

	const factory = (ctx: ExtensionContext) => (tui: any, theme: any, footerData: any) => {
		const cfg = loadConfig();
		const SEP = cfg.separator;
		const unsub = footerData.onBranchChange(() => tui.requestRender());

		const width = (s: string) => visibleWidth(s);
		const span = (texts: string[], i: number, j: number) => {
			let w = 0;
			for (let k = i; k < j; k++) w += (k === i ? 0 : SEP.length) + width(texts[k]);
			return w;
		};

		/** Greedy flow: fill each line as far as it goes, then wrap. */
		const flow = (texts: string[], w: number): number[][] => {
			const lines: number[][] = [];
			let cur: number[] = [];
			let used = 0;
			for (let i = 0; i < texts.length; i++) {
				const seg = width(texts[i]);
				const cost = cur.length === 0 ? seg : SEP.length + seg;
				if (cur.length > 0 && used + cost > w) {
					lines.push(cur);
					cur = [i];
					used = seg;
				} else {
					cur.push(i);
					used += cost;
				}
			}
			if (cur.length > 0) lines.push(cur);
			return lines;
		};

		/** Re-wrap into exactly `lineCount` lines minimising squared slack. */
		const balance = (texts: string[], w: number, lineCount: number): number[][] | null => {
			const n = texts.length;
			if (lineCount <= 1 || lineCount >= n) return null;
			const cost = new Map<string, number>();
			const cut = new Map<string, number>();
			const solve = (i: number, k: number): number => {
				if (k === 1) {
					const s = span(texts, i, n);
					return s > w ? Number.POSITIVE_INFINITY : (w - s) ** 2;
				}
				const key = `${i}|${k}`;
				const hit = cost.get(key);
				if (hit !== undefined) return hit;
				let best = Number.POSITIVE_INFINITY;
				let bestJ = -1;
				for (let j = i + 1; j <= n - (k - 1); j++) {
					const s = span(texts, i, j);
					if (s > w) break;
					const rest = solve(j, k - 1);
					if (!Number.isFinite(rest)) continue;
					const c = (w - s) ** 2 + rest;
					if (c < best) {
						best = c;
						bestJ = j;
					}
				}
				cost.set(key, best);
				cut.set(key, bestJ);
				return best;
			};
			if (!Number.isFinite(solve(0, lineCount))) return null;
			const out: number[][] = [];
			let i = 0;
			for (let k = lineCount; k > 1; k--) {
				const j = cut.get(`${i}|${k}`) ?? n;
				if (j <= i) return null;
				out.push(Array.from({ length: j - i }, (_, x) => x + i));
				i = j;
			}
			out.push(Array.from({ length: n - i }, (_, x) => x + i));
			return out;
		};

		/** Share leftover space between gaps, capped so lines stay compact. */
		const justify = (parts: string[], w: number): string => {
			if (parts.length < 2 || cfg.maxGap === 0) return parts.join(SEP);
			const ink = parts.reduce((a, p) => a + width(p), 0);
			const gaps = parts.length - 1;
			const slack = w - ink - gaps * SEP.length;
			if (slack <= 0) return parts.join(SEP);
			const extra = Math.min(cfg.maxGap, Math.floor(slack / gaps));
			return extra > 0 ? parts.join(SEP + " ".repeat(extra)) : parts.join(SEP);
		};

		return {
			dispose: unsub,
			invalidate() {},
			render(w: number): string[] {
				if (w < 8) return [];

				const t = collect(ctx);
				const cu = ctx.getContextUsage();
				const win = cu?.contextWindow ?? (ctx.model as any)?.contextWindow ?? 0;
				const pct = cu?.percent ?? null;
				const usedTok = cu?.tokens ?? null;

				const modelId = ctx.model?.id ?? "no-model";
				const think = ctx.thinkingLevel ?? "off";
				const branch = footerData.getGitBranch();
				const cwd = shortHome(process.cwd());

				const pctStr = pct === null ? "?" : `${pct.toFixed(0)}%`;
				const ctxNums = usedTok === null ? `?/${fmt(win)}` : `${fmt(usedTok)}/${fmt(win)}`;
				const hitStr = t.hit === null ? "—" : `${t.hit.toFixed(0)}%`;
				const ctxColor =
					pct === null ? "muted" : pct >= cfg.ctxDanger ? "error" : pct >= cfg.ctxWarn ? "warning" : "success";

				// Priority decides what survives when space runs out, never how a
				// field is worded. Higher wins.
				const build = (cells: number): Segment[] =>
					[
						{ id: "model", text: `${modelId} · think ${think}`, color: "accent", priority: 9 },
						{
							id: "ctx",
							text: `ctx ${bar(pct ?? 0, cells)} ${pctStr} ${ctxNums}`,
							color: ctxColor,
							priority: 10,
						},
						{ id: "in", text: `in ${fmt(t.input)}`, color: "muted", priority: 6 },
						{ id: "out", text: `out ${fmt(t.output)}`, color: "muted", priority: 6 },
						{ id: "cache", text: `cache ${fmt(t.cacheRead)}/${fmt(t.cacheWrite)}`, color: "muted", priority: 5 },
						{ id: "hit", text: `hit ${hitStr}`, color: "muted", priority: 7 },
						{ id: "cost", text: `$${t.cost.toFixed(3)}`, color: "dim", priority: 8 },
						{ id: "cwd", text: branch ? `${cwd} (${branch})` : cwd, color: "dim", priority: 3 },
					]
						.filter((s) => !cfg.hide.includes(s.id) && s.text.trim().length > 0)
						.map((s) => ({ ...s, priority: cfg.priority[s.id] ?? s.priority }));

				// Drop the least important fields only if the line budget is blown.
				let segs = build(4);
				while (segs.length > 1 && flow(segs.map((s) => s.text), w).length > cfg.maxLines) {
					let worst = 0;
					for (let i = 1; i < segs.length; i++) if (segs[i].priority < segs[worst].priority) worst = i;
					segs = segs.filter((_, i) => i !== worst);
				}
				if (segs.length === 0) return [];
				const keep = new Set(segs.map((s) => s.id));
				const lineCount = flow(segs.map((s) => s.text), w).length;

				// Grow the context bar into leftover space while the wrap holds.
				const maxCells = clamp(Math.floor(w / 3), 6, 28);
				let cells = 4;
				for (let c = 5; c <= maxCells; c++) {
					const trial = build(c).filter((s) => keep.has(s.id)).map((s) => s.text);
					if (flow(trial, w).length > lineCount) break;
					cells = c;
				}

				const final = build(cells).filter((s) => keep.has(s.id));
				const texts = final.map((s) => s.text);
				let packed = flow(texts, w);
				const balanced = balance(texts, w, packed.length);
				if (balanced) packed = balanced;

				const out = packed.map((line) =>
					truncateToWidth(justify(line.map((i) => theme.fg(final[i].color, texts[i])), w), w),
				);

				const statuses: string[] = footerData.getExtensionStatuses?.() ?? [];
				if (statuses.length > 0) out.push(truncateToWidth(statuses.join(SEP), w));
				return out;
			},
		};
	};

	// Reinstall on session start and after /reload so hot reloads keep working.
	const apply = (ctx: ExtensionContext) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setFooter(enabled ? factory(ctx) : undefined);
	};

	pi.on("session_start", async (_e, ctx) => apply(ctx));
	pi.on("reload", async (_e, ctx) => apply(ctx));

	pi.registerCommand("footer", {
		description: "Toggle responsive footer / built-in footer",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			apply(ctx);
			ctx.ui.notify(enabled ? "Responsive footer enabled" : "Built-in footer restored", "info");
		},
	});
}
