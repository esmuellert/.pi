import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { installResponsiveFooter } from "./index.ts";

const now = 10_000;
const quotaPayload = {
	rate_limit: {
		primary_window: { used_percent: 44, limit_window_seconds: 18_000, reset_at: 8_710 },
		secondary_window: { used_percent: 7, limit_window_seconds: 604_800, reset_at: 518_410 },
	},
};

type Handler = (event: any, ctx: ExtensionContext) => unknown;

function harness() {
	const handlers = new Map<string, Handler[]>();
	let footerFactory: any;
	let footerSets = 0;
	let renders = 0;
	let fetches = 0;
	const pi = {
		on(name: string, handler: Handler) {
			const list = handlers.get(name) ?? [];
			list.push(handler);
			handlers.set(name, list);
		},
	} as unknown as ExtensionAPI;
	const raw: any = {
		mode: "tui",
		cwd: "/repo",
		model: { provider: "github-copilot", api: "openai-responses", id: "gpt-5.6-sol", contextWindow: 1_000_000 },
		thinkingLevel: "max",
		modelRegistry: {
			runtime: { isUsingSubscription: () => true },
			getProviderAuth: async () => ({ auth: { apiKey: fakeJwt() }, source: "stored" }),
		},
		sessionManager: {
			getBranch: () => [],
			getSessionName: () => null,
		},
		getContextUsage: () => ({ percent: 0, tokens: 0, contextWindow: raw.model.contextWindow }),
		hasPendingMessages: () => false,
		ui: {
			setFooter(factory: any) {
				footerSets += 1;
				footerFactory = factory;
			},
		},
	};
	const ctx = raw as ExtensionContext;
	installResponsiveFooter(pi, {
		now: () => now,
		fetchImpl: async () => {
			fetches += 1;
			return new Response(JSON.stringify(quotaPayload), { status: 200 });
		},
	});
	const emit = async (name: string, event: any = {}) => {
		for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
	};
	const render = () => {
		const component = footerFactory(
			{ requestRender: () => { renders += 1; } },
			{ fg: (_color: string, text: string) => text },
			{ onBranchChange: () => () => {}, getGitBranch: () => null, getExtensionStatuses: () => new Map() },
		);
		return component.render(100).join("\n");
	};
	return { ctx: raw, emit, render, getFetches: () => fetches, getFooterSets: () => footerSets, getRenders: () => renders };
}

function fakeJwt(): string {
	const claims = Buffer.from(JSON.stringify({
		"https://api.openai.com/auth": { chatgpt_account_id: "account-secret" },
	})).toString("base64url");
	return `header.${claims}.signature`;
}

describe("responsive footer Codex lifecycle", () => {
	it("fetches only for the selected Codex provider and switches immediately", async () => {
		const app = harness();
		await app.emit("session_start", { type: "session_start", reason: "startup" });
		assert.equal(app.getFooterSets(), 1);
		assert.equal(app.getFetches(), 0);
		assert.match(app.render(), /\$0\.000 sub/u);

		app.ctx.model = { ...app.ctx.model, provider: "openai-codex", api: "openai-codex-responses", contextWindow: 272_000 };
		await app.emit("model_select", { type: "model_select", model: app.ctx.model, source: "set" });
		assert.match(app.render(), /\$0\.000 codex/u, "provider label should change before the fetch finishes");
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(app.getFetches(), 1);
		assert.match(app.render(), /2h25m ███░░░ 44%/u);
		assert.match(app.render(), /6d ░░░░░░ 7%/u);

		app.ctx.model = { ...app.ctx.model, provider: "github-copilot", api: "openai-responses", contextWindow: 1_000_000 };
		await app.emit("model_select", { type: "model_select", model: app.ctx.model, source: "cycle" });
		assert.doesNotMatch(app.render(), /███░░░ 44%/u);
		assert.match(app.render(), /\$0\.000 sub/u);
		assert.equal(app.getFooterSets(), 1, "model switching must not replace the footer");
		assert.ok(app.getRenders() > 0);
	});
});
