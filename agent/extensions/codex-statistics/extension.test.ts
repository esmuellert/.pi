import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { installCodexStatistics } from "./extension.ts";

const quotaPayload = {
	plan_type: "plus",
	rate_limit: {
		primary_window: { used_percent: 19, limit_window_seconds: 18_000, reset_at: 14_410 },
		secondary_window: { used_percent: 3, limit_window_seconds: 604_800, reset_at: 518_410 },
	},
};

type Handler = (event: any, ctx: ExtensionContext) => unknown;

function harness(fetchImpl: typeof fetch, dataDir: string) {
	const handlers = new Map<string, Handler[]>();
	let uiCalls = 0;
	const pi = {
		on(name: string, handler: Handler) {
			const list = handlers.get(name) ?? [];
			list.push(handler);
			handlers.set(name, list);
		},
	} as unknown as ExtensionAPI;

	const raw: any = {
		mode: "tui",
		hasUI: true,
		cwd: "/private/project/path",
		model: {
			provider: "github-copilot",
			api: "openai-responses",
			id: "gpt-5.6-sol",
			contextWindow: 1_000_000,
		},
		thinkingLevel: "max",
		modelRegistry: {
			getProviderAuth: async () => ({ auth: { apiKey: fakeJwt() }, source: "stored" }),
		},
		sessionManager: {
			getSessionId: () => "session-secret",
		},
		ui: new Proxy({}, { get: () => () => { uiCalls += 1; } }),
	};
	const ctx = raw as ExtensionContext;
	installCodexStatistics(pi, {
		fetchImpl,
		dataDir,
		now: () => 10_000,
		randomId: (() => {
			let id = 0;
			return () => `id-${++id}`;
		})(),
	});

	const emit = async (name: string, event: any = {}) => {
		for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
	};
	return { ctx: raw, emit, getUiCalls: () => uiCalls };
}

function fakeJwt(): string {
	const claims = Buffer.from(JSON.stringify({
		"https://api.openai.com/auth": { chatgpt_account_id: "account-secret" },
	})).toString("base64url");
	return `header.${claims}.signature`;
}

describe("Codex statistics extension", () => {
	it("stays inert unless the quota endpoint verifies the login", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-codex-disabled-"));
		try {
			const app = harness(async () => new Response("denied", { status: 401 }), directory);
			await app.emit("session_start", { type: "session_start", reason: "startup" });
			await app.emit("agent_start", { type: "agent_start" });
			await app.emit("agent_end", { type: "agent_end", messages: [] });
			assert.equal(app.getUiCalls(), 0);
			await assert.rejects(readFile(join(directory, "usage-1970-01-01.jsonl"), "utf8"), { code: "ENOENT" });
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("has no UI behavior after successful verification", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-codex-statistics-ui-"));
		try {
			const app = harness(async () => new Response(JSON.stringify(quotaPayload), { status: 200 }), directory);
			await app.emit("session_start", { type: "session_start", reason: "startup" });
			assert.equal(app.getUiCalls(), 0);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("writes one content-free JSONL record for an enabled reply", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-codex-reply-"));
		try {
			const app = harness(async () => new Response(JSON.stringify(quotaPayload), { status: 200 }), directory);
			app.ctx.model = { ...app.ctx.model, provider: "openai-codex", api: "openai-codex-responses" };
			await app.emit("session_start", { type: "session_start", reason: "startup" });
			await app.emit("agent_start", { type: "agent_start" });
			await app.emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 9_000 });
			await app.emit("turn_end", {
				type: "turn_end",
				turnIndex: 0,
				message: {
					role: "assistant",
					provider: "openai-codex",
					api: "openai-codex-responses",
					model: "gpt-5.6-sol",
					content: [{ type: "text", text: "DO NOT STORE THIS" }],
					usage: {
						input: 10,
						cacheRead: 20,
						cacheWrite: 0,
						output: 5,
						reasoning: 2,
						totalTokens: 35,
						cost: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 },
					},
					stopReason: "stop",
					timestamp: 10_000,
				},
				toolResults: [],
			});
			await app.emit("agent_end", { type: "agent_end", messages: [] });
			const line = await readFile(join(directory, "usage-1970-01-01.jsonl"), "utf8");
			assert.equal(line.trim().split("\n").length, 1);
			assert.equal(line.includes("DO NOT STORE THIS"), false);
			const record = JSON.parse(line);
			assert.equal(record.totals.model.totalTokens, 35);
			assert.equal("quotaBefore" in record, false);
			assert.equal("quotaAfter" in record, false);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
