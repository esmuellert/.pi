import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { addTurn, finishReply, JsonlLedger, startReply, type ReplyDraft } from "./ledger.ts";
import { CODEX_USAGE_STATE_EVENT, type CodexUsageState } from "./protocol.ts";
import { extractAccountId, fetchQuota, type QuotaSnapshot } from "./quota.ts";

export interface CodexStudyDependencies {
	fetchImpl?: typeof fetch;
	now?: () => number;
	randomId?: () => string;
	dataDir?: string;
}

export function installCodexStudy(pi: ExtensionAPI, dependencies: CodexStudyDependencies = {}): void {
	const fetchImpl = dependencies.fetchImpl ?? fetch;
	const now = dependencies.now ?? Date.now;
	const randomId = dependencies.randomId ?? randomUUID;
	const processRef = randomId();
	const ledger = new JsonlLedger(dependencies.dataDir);
	const turnStarts = new Map<number, number>();
	let usageState: CodexUsageState = { verified: false, quota: null };
	let reply: ReplyDraft | null = null;
	let requestGeneration = 0;
	let requestController: AbortController | null = null;
	let inflight: Promise<QuotaSnapshot> | null = null;

	const publish = () => pi.events.emit(CODEX_USAGE_STATE_EVENT, usageState);

	async function readQuota(ctx: ExtensionContext): Promise<QuotaSnapshot> {
		if (inflight) return inflight;
		const generation = requestGeneration;
		requestController?.abort();
		requestController = new AbortController();
		const signal = requestController.signal;
		inflight = (async () => {
			const auth = await ctx.modelRegistry.getProviderAuth("openai-codex");
			const apiKey = auth?.auth.apiKey;
			if (!apiKey) throw new Error("OpenAI Codex OAuth is not configured");
			const snapshot = await fetchQuota({
				apiKey,
				accountId: extractAccountId(apiKey),
				fetchImpl,
				now,
				signal,
			});
			if (generation !== requestGeneration) throw new Error("Stale Codex quota request");
			usageState = { verified: true, quota: snapshot };
			publish();
			return snapshot;
		})();
		try {
			return await inflight;
		} finally {
			if (generation === requestGeneration) inflight = null;
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		requestGeneration += 1;
		requestController?.abort();
		requestController = null;
		inflight = null;
		usageState = { verified: false, quota: null };
		reply = null;
		turnStarts.clear();
		try {
			await readQuota(ctx);
		} catch {
			publish();
		}
	});

	pi.on("model_select", (_event, ctx) => {
		if (!usageState.verified) return;
		publish();
		if (ctx.model?.provider === "openai-codex") void readQuota(ctx).catch(() => {});
	});

	pi.on("agent_start", (_event, ctx) => {
		if (!usageState.verified) return;
		reply = startReply(ctx, processRef, usageState.quota, now(), randomId());
		turnStarts.clear();
	});

	pi.on("turn_start", (event) => {
		if (!usageState.verified || !reply) return;
		turnStarts.set(event.turnIndex, event.timestamp);
	});

	pi.on("turn_end", (event, ctx) => {
		if (!usageState.verified || !reply) return;
		addTurn(reply, event, ctx.thinkingLevel ?? "off", turnStarts.get(event.turnIndex), now());
		turnStarts.delete(event.turnIndex);
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (!usageState.verified || !reply) return;
		const finished = reply;
		reply = null;
		turnStarts.clear();
		const usedCodex = finished.startModel?.provider === "openai-codex" ||
			finished.turns.some((turn) => turn.model.provider === "openai-codex");
		let quotaAfter = usageState.quota;
		if (usedCodex) {
			try {
				quotaAfter = await readQuota(ctx);
			} catch {
				// The turn record remains useful when the quota endpoint is unavailable.
			}
		}
		await ledger.append(finishReply(finished, quotaAfter, now()));
	});

	pi.on("session_shutdown", async () => {
		requestGeneration += 1;
		requestController?.abort();
		requestController = null;
		inflight = null;
		usageState = { verified: false, quota: null };
		publish();
		reply = null;
		turnStarts.clear();
		await ledger.flush();
	});
}

export default function codexStudy(pi: ExtensionAPI): void {
	installCodexStudy(pi);
}
