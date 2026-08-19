/**
 * Responsive Footer — extension entry point.
 *
 * Wiring only: reads session state, delegates to the pure layout engine, and
 * paints the result. All layout logic lives in ./layout.ts so it can be tested
 * without a running pi instance (see ./layout.test.ts).
 *
 * Commands: /footer toggles between this footer and the built-in one.
 * Config:   ~/.pi/agent/footer.json (see ./config.ts)
 */

import { homedir } from "node:os";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { loadConfig, saveConfigKey } from "./config.ts";
import { lineText, planLayout } from "./layout.ts";
import { type FooterState, ICON, makeBuilder } from "./segments.ts";

interface Usage {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: { total?: number };
}

/** Kimi Coding is subscription-backed despite using API-key auth, like the built-in footer. */
function detectSubscription(ctx: ExtensionContext, provider: string): boolean {
	if (!provider) return false;
	if (provider === "kimi-coding") return true;
	try {
		// isUsingSubscription lives on ModelRuntime, which extensions do not get
		// directly. Reaching through the registry is private API, so treat any
		// failure as "not a subscription" rather than breaking the footer.
		const runtime = (ctx.modelRegistry as any)?.runtime;
		return runtime?.isUsingSubscription?.(provider) === true;
	} catch {
		return false;
	}
}

/** Sum usage across the active branch, mirroring the built-in footer's totals. */
function readState(ctx: ExtensionContext): FooterState {
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let cost = 0;
	let hitRate: number | null = null;

	for (const entry of ctx.sessionManager.getBranch()) {
		let u: Usage | undefined;
		if (entry.type === "message" && entry.message.role === "assistant") u = (entry.message as AssistantMessage).usage;
		else if (entry.type === "message" && entry.message.role === "toolResult") u = (entry.message as any).usage;
		else if (entry.type === "branch_summary" || entry.type === "compaction") u = (entry as any).usage;
		if (!u) continue;

		input += u.input ?? 0;
		output += u.output ?? 0;
		cacheRead += u.cacheRead ?? 0;
		cacheWrite += u.cacheWrite ?? 0;
		cost += u.cost?.total ?? 0;
		// "Latest cache hit rate", matching the built-in CH field.
		const prompt = (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
		if (prompt > 0) hitRate = ((u.cacheRead ?? 0) / prompt) * 100;
	}

	const usage = ctx.getContextUsage();
	const provider = (ctx.model as any)?.provider ?? "";
	return {
		modelId: ctx.model?.id ?? "no-model",
		provider,
		thinkingLevel: ctx.thinkingLevel ?? "off",
		contextPercent: usage?.percent ?? null,
		contextTokens: usage?.tokens ?? null,
		contextWindow: usage?.contextWindow ?? (ctx.model as any)?.contextWindow ?? 0,
		input,
		output,
		cacheRead,
		cacheWrite,
		cost,
		hitRate,
		usingSubscription: detectSubscription(ctx, provider),
		cwd: ctx.cwd,
		branch: null,
		sessionName: ctx.sessionManager.getSessionName() ?? null,
		queued: ctx.hasPendingMessages(),
		home: homedir(),
	};
}

export default function (pi: ExtensionAPI) {
	let enabled = true;

	const factory = (ctx: ExtensionContext) => (tui: any, theme: any, footerData: any) => {
		const cfg = loadConfig();
		const unsub = footerData.onBranchChange(() => tui.requestRender());

		return {
			dispose: unsub,
			invalidate() {},
			render(width: number): string[] {
				if (width < 4) return [];

				const state = readState(ctx);
				state.branch = footerData.getGitBranch() ?? null;

				const layout = planLayout(makeBuilder(state, cfg), width, {
					separator: cfg.separator,
					maxGap: cfg.maxGap,
					minBar: cfg.minBar,
					maxBar: cfg.maxBar,
					// pi-tui's measure also strips ANSI and handles wide glyphs.
					measure: visibleWidth,
				});

				const out = layout.lines.map((line) => {
					const joiner = cfg.separator + " ".repeat(line.gap);
					const painted = line.items.map((s) => theme.fg(s.color, s.text)).join(joiner);
					// Guard against a single segment wider than the terminal.
					return visibleWidth(lineText(line, cfg.separator)) > width ? truncateToWidth(painted, width) : painted;
				});

				// getExtensionStatuses returns a Map, not an array.
				const statuses = footerData.getExtensionStatuses?.();
				const texts = statuses ? [...statuses.values()].filter((t) => typeof t === "string" && t.length > 0) : [];
				if (texts.length > 0) out.push(truncateToWidth(texts.join(cfg.separator), width));
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

	pi.registerCommand("footer-icons", {
		description: "Check Nerd Font glyphs and remember whether to use them",
		handler: async (_args, ctx) => {
			// Terminals do not expose their font, and a missing glyph renders as a
			// box that still measures one cell — so no probe can tell. The user can
			// see the answer; we just record it.
			const probe = `${ICON.folder}  ${ICON.branch}  ${ICON.cache}`;
			const ok = await ctx.ui.confirm(
				"Nerd Font check",
				`Do these render as a folder, a branch and a database?\n\n    ${probe}\n\n` +
					"Yes keeps the icons. No falls back to the words 'cache' and '(branch)'.",
			);
			saveConfigKey("icons", ok);
			apply(ctx);
			ctx.ui.notify(ok ? "Icons enabled and saved" : "Icons off, words restored", "info");
		},
	});

	pi.registerCommand("footer", {
		description: "Toggle responsive footer / built-in footer",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			apply(ctx);
			ctx.ui.notify(enabled ? "Responsive footer enabled" : "Built-in footer restored", "info");
		},
	});
}
