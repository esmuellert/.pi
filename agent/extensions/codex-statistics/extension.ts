import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { addTurn, finishReply, JsonlLedger, startReply, type ReplyDraft } from "./ledger.ts";
import { extractAccountId, fetchQuota, type QuotaSnapshot } from "./quota.ts";

export interface CodexStatisticsDependencies {
	fetchImpl?: typeof fetch;
	now?: () => number;
	randomId?: () => string;
	dataDir?: string;
}

export function installCodexStatistics(pi: ExtensionAPI, dependencies: CodexStatisticsDependencies = {}): void {
	const fetchImpl = dependencies.fetchImpl ?? fetch;
	const now = dependencies.now ?? Date.now;
	const randomId = dependencies.randomId ?? randomUUID;
	const processRef = randomId();
	const ledger = new JsonlLedger(dependencies.dataDir);
	const turnStarts = new Map<number, number>();
	let enabled = false;
	let reply: ReplyDraft | null = null;
	let quotaBefore: Promise<QuotaSnapshot | null> | null = null;
	let verificationGeneration = 0;
	let verificationController: AbortController | null = null;
	let verification: Promise<void> | null = null;

	async function readQuota(ctx: ExtensionContext, signal?: AbortSignal): Promise<QuotaSnapshot> {
		const auth = await ctx.modelRegistry.getProviderAuth("openai-codex");
		const apiKey = auth?.auth.apiKey;
		if (!apiKey) throw new Error("OpenAI Codex OAuth is not configured");
		return fetchQuota({
			apiKey,
			accountId: extractAccountId(apiKey),
			fetchImpl,
			now,
			signal,
		});
	}

	async function sampleQuota(ctx: ExtensionContext): Promise<QuotaSnapshot | null> {
		try {
			return await readQuota(ctx);
		} catch {
			return null;
		}
	}

	async function verifyLogin(ctx: ExtensionContext): Promise<void> {
		if (verification) return verification;
		const generation = verificationGeneration;
		const controller = new AbortController();
		verificationController = controller;
		verification = (async () => {
			await readQuota(ctx, controller.signal);
			if (generation !== verificationGeneration) throw new Error("Stale Codex login verification");
		})();
		try {
			await verification;
		} finally {
			if (generation === verificationGeneration) verification = null;
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		verificationGeneration += 1;
		verificationController?.abort();
		verificationController = null;
		verification = null;
		enabled = false;
		reply = null;
		quotaBefore = null;
		turnStarts.clear();
		try {
			await verifyLogin(ctx);
			enabled = true;
		} catch {
			// A configured credential is not enough: logging starts only after verification.
		}
	});

	pi.on("model_select", async (_event, ctx) => {
		if (enabled || ctx.model?.provider !== "openai-codex") return;
		try {
			await verifyLogin(ctx);
			enabled = true;
		} catch {
			// Keep metrics disabled until the subscription can be verified.
		}
	});

	pi.on("agent_start", (_event, ctx) => {
		if (!enabled) return;
		reply = startReply(ctx, processRef, now(), randomId());
		quotaBefore = reply.startModel?.provider === "openai-codex"
			? sampleQuota(ctx)
			: Promise.resolve(null);
		turnStarts.clear();
	});

	pi.on("turn_start", (event) => {
		if (!enabled || !reply) return;
		turnStarts.set(event.turnIndex, event.timestamp);
	});

	pi.on("turn_end", (event, ctx) => {
		if (!enabled || !reply) return;
		addTurn(reply, event, ctx.thinkingLevel ?? "off", turnStarts.get(event.turnIndex), now());
		turnStarts.delete(event.turnIndex);
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (!enabled || !reply) return;
		const finished = reply;
		const before = quotaBefore;
		reply = null;
		quotaBefore = null;
		turnStarts.clear();
		const quotaBeforeSnapshot = await (before ?? Promise.resolve(null));
		const quotaAfterSnapshot = finished.startModel?.provider === "openai-codex"
			? await sampleQuota(ctx)
			: null;
		await ledger.append(finishReply(finished, now(), quotaBeforeSnapshot, quotaAfterSnapshot));
	});

	pi.on("session_shutdown", async () => {
		verificationGeneration += 1;
		verificationController?.abort();
		verificationController = null;
		verification = null;
		enabled = false;
		reply = null;
		quotaBefore = null;
		turnStarts.clear();
		await ledger.flush();
	});
}

export default function codexStatistics(pi: ExtensionAPI): void {
	installCodexStatistics(pi);
}
