import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { extractCodexAccountId, fetchCodexQuota, parseCodexQuota, type QuotaSnapshot } from "./codex.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import { lineText, planLayout } from "./layout.ts";
import { EMPTY_STATE, type FooterState, makeBuilder } from "./segments.ts";

const now = Date.UTC(2026, 8, 5, 0, 0, 0);
const quota: QuotaSnapshot = {
	fetchedAt: now,
	primary: { usedPercent: 44, windowSeconds: 18_000, resetAt: now / 1000 + 2 * 3600 + 25 * 60 },
	secondary: { usedPercent: 7, windowSeconds: 604_800, resetAt: now / 1000 + 6 * 86400 + 21 * 3600 },
};

function state(provider: string): FooterState {
	return {
		...EMPTY_STATE,
		modelId: "gpt-6-astra",
		provider,
		thinkingLevel: "max",
		contextPercent: 20,
		contextTokens: 54_000,
		contextWindow: 272_000,
		input: 1_200,
		output: 300,
		cacheRead: 20_000,
		cost: 0.123,
		usingSubscription: true,
		codexQuota: quota,
		now,
		cwd: "/tmp/project",
	};
}

describe("Codex quota source", () => {
	it("requires both windows from the authenticated endpoint", () => {
		assert.equal(parseCodexQuota({ rate_limit: { primary_window: {} } }), null);
		assert.deepEqual(parseCodexQuota({
			rate_limit: {
				primary_window: { used_percent: 44, limit_window_seconds: 18_000, reset_at: 1 },
				secondary_window: { used_percent: 7, limit_window_seconds: 604_800, reset_at: 2 },
			},
		}, 3), {
			fetchedAt: 3,
			primary: { usedPercent: 44, windowSeconds: 18_000, resetAt: 1 },
			secondary: { usedPercent: 7, windowSeconds: 604_800, resetAt: 2 },
		});
	});

	it("uses the OAuth account claim without retaining it", async () => {
		const payload = Buffer.from(JSON.stringify({
			"https://api.openai.com/auth": { chatgpt_account_id: "account-secret" },
		})).toString("base64url");
		const token = `header.${payload}.signature`;
		let accountHeader = "";
		const snapshot = await fetchCodexQuota({
			apiKey: token,
			accountId: extractCodexAccountId(token),
			now: () => 3,
			fetchImpl: async (_input, init) => {
				accountHeader = new Headers(init?.headers).get("chatgpt-account-id") ?? "";
				return new Response(JSON.stringify({
					rate_limit: {
						primary_window: { used_percent: 44, limit_window_seconds: 18_000, reset_at: 1 },
						secondary_window: { used_percent: 7, limit_window_seconds: 604_800, reset_at: 2 },
					},
				}), { status: 200 });
			},
		});
		assert.equal(accountHeader, "account-secret");
		assert.equal(JSON.stringify(snapshot).includes("account-secret"), false);
	});
});

describe("Codex quota segments", () => {
	it("matches the local Claude Code reset, bar, percentage format", () => {
		const items = makeBuilder(state("openai-codex"), DEFAULT_CONFIG)(8);
		assert.equal(items.find((item) => item.id === "codex-5h")!.text, "2h25m ███░░░ 44%");
		assert.equal(items.find((item) => item.id === "codex-week")!.text, "6d ░░░░░░ 7%");
		assert.match(items.find((item) => item.id === "cost")!.text, / codex$/u);
		assert.doesNotMatch(items.map((item) => item.text).join(" "), /Codex 5h|Codex week|used|resets in/u);
	});

	it("uses only the selected provider to choose Codex presentation", () => {
		const items = makeBuilder(state("github-copilot"), DEFAULT_CONFIG)(8);
		assert.equal(items.some((item) => item.id.startsWith("codex-")), false);
		assert.match(items.find((item) => item.id === "cost")!.text, / sub$/u);
	});

	it("wraps every field instead of dropping quota on a narrow terminal", () => {
		const value = state("openai-codex");
		const expected = makeBuilder(value, DEFAULT_CONFIG)(8).map((item) => item.id).sort();
		for (let width = 24; width <= 160; width += 1) {
			const layout = planLayout(makeBuilder(value, DEFAULT_CONFIG), width, {
				separator: DEFAULT_CONFIG.separator,
				maxGap: DEFAULT_CONFIG.maxGap,
				minBar: DEFAULT_CONFIG.minBar,
				maxBar: DEFAULT_CONFIG.maxBar,
				measure: visibleWidth,
			});
			assert.deepEqual(layout.lines.flatMap((line) => line.items.map((item) => item.id)).sort(), expected);
			for (const line of layout.lines) {
				const text = lineText(line, DEFAULT_CONFIG.separator);
				if (line.items.length > 1 || visibleWidth(line.items[0]!.text) <= width) {
					assert.ok(visibleWidth(text) <= width, `overflow at ${width}`);
				}
			}
		}
	});
});
