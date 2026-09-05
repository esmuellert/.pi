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
import { extractCodexAccountId, fetchCodexQuota, type QuotaSnapshot } from "./codex.ts";
import { loadConfig } from "./config.ts";
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
function readState(ctx: ExtensionContext, codexQuota: QuotaSnapshot | null, now: number): FooterState {
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let cost = 0;
	let hitRate: number | null = null;
	let compactions = 0;

	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "compaction") compactions += 1;
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
		compactions,
		input,
		output,
		cacheRead,
		cacheWrite,
		cost,
		hitRate,
		usingSubscription: detectSubscription(ctx, provider),
		codexQuota,
		now,
		cwd: ctx.cwd,
		branch: null,
		sessionName: ctx.sessionManager.getSessionName() ?? null,
		queued: ctx.hasPendingMessages(),
		home: homedir(),
	};
}

export interface ResponsiveFooterDependencies {
	fetchImpl?: typeof fetch;
	now?: () => number;
}

export function installResponsiveFooter(pi: ExtensionAPI, dependencies: ResponsiveFooterDependencies = {}): void {
	const fetchImpl = dependencies.fetchImpl ?? fetch;
	const now = dependencies.now ?? Date.now;
	let codexQuota: QuotaSnapshot | null = null;
	let footerTui: { requestRender(): void } | null = null;
	let quotaGeneration = 0;
	let quotaController: AbortController | null = null;
	let quotaInflight: Promise<void> | null = null;

	const refreshCodexQuota = (ctx: ExtensionContext): Promise<void> => {
		if (ctx.model?.provider !== "openai-codex") return Promise.resolve();
		if (quotaInflight) return quotaInflight;
		const generation = quotaGeneration;
		const controller = new AbortController();
		quotaController = controller;
		quotaInflight = (async () => {
			const auth = await ctx.modelRegistry.getProviderAuth("openai-codex");
			const apiKey = auth?.auth.apiKey;
			if (!apiKey) return;
			const snapshot = await fetchCodexQuota({
				apiKey,
				accountId: extractCodexAccountId(apiKey),
				fetchImpl,
				now,
				signal: controller.signal,
			});
			if (generation !== quotaGeneration || ctx.model?.provider !== "openai-codex") return;
			codexQuota = snapshot;
			footerTui?.requestRender();
		})().catch(() => {}).finally(() => {
			if (generation === quotaGeneration) quotaInflight = null;
		});
		return quotaInflight;
	};

	const selectModel = (ctx: ExtensionContext) => {
		quotaGeneration += 1;
		quotaController?.abort();
		quotaController = null;
		quotaInflight = null;
		codexQuota = null;
		footerTui?.requestRender();
		if (ctx.model?.provider === "openai-codex") void refreshCodexQuota(ctx);
	};

	const factory = (ctx: ExtensionContext) => (tui: any, theme: any, footerData: any) => {
		footerTui = tui;
		const cfg = loadConfig();
		const unsub = footerData.onBranchChange(() => tui.requestRender());

		return {
			dispose() {
				unsub();
				if (footerTui === tui) footerTui = null;
			},
			invalidate() {},
			render(width: number): string[] {
				if (width < 4) return [];

				const state = readState(ctx, codexQuota, now());
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

	// session_start also fires after /reload, with reason "reload", so this one
	// handler covers both. There is no separate "reload" event.
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setFooter(factory(ctx));
		selectModel(ctx);
	});

	pi.on("model_select", (_event, ctx) => selectModel(ctx));
	pi.on("agent_end", (_event, ctx) => {
		if (ctx.model?.provider === "openai-codex") void refreshCodexQuota(ctx);
	});
	pi.on("session_shutdown", () => {
		quotaGeneration += 1;
		quotaController?.abort();
		quotaController = null;
		quotaInflight = null;
		codexQuota = null;
		footerTui = null;
	});
}

export default installResponsiveFooter;
