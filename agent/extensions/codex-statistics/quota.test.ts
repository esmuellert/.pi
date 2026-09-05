import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractAccountId, fetchQuota, parseQuota } from "./quota.ts";

const payload = {
	plan_type: "plus",
	rate_limit: {
		primary_window: {
			used_percent: 19,
			limit_window_seconds: 18_000,
			reset_at: 1_800_000_000,
		},
		secondary_window: {
			used_percent: 3,
			limit_window_seconds: 604_800,
			reset_at: 1_800_604_800,
		},
	},
};

describe("Codex quota", () => {
	it("requires both reported windows", () => {
		assert.equal(parseQuota({ rate_limit: { primary_window: payload.rate_limit.primary_window } }), null);
		assert.deepEqual(parseQuota(payload, 123), {
			fetchedAt: 123,
			planType: "plus",
			primary: { usedPercent: 19, windowSeconds: 18_000, resetAt: 1_800_000_000 },
			secondary: { usedPercent: 3, windowSeconds: 604_800, resetAt: 1_800_604_800 },
		});
	});

	it("extracts the account id without retaining other claims", () => {
		const claims = Buffer.from(JSON.stringify({
			"https://api.openai.com/auth": { chatgpt_account_id: "acct-local" },
		})).toString("base64url");
		assert.equal(extractAccountId(`header.${claims}.signature`), "acct-local");
		assert.equal(extractAccountId("not-a-jwt"), undefined);
	});

	it("sends OAuth only to the usage endpoint and returns a safe snapshot", async () => {
		let seenUrl = "";
		let seenAuthorization = "";
		let seenAccount = "";
		const snapshot = await fetchQuota({
			apiKey: "secret-access-token",
			accountId: "acct-local",
			now: () => 456,
			fetchImpl: async (input, init) => {
				seenUrl = String(input);
				const headers = new Headers(init?.headers);
				seenAuthorization = headers.get("authorization") ?? "";
				seenAccount = headers.get("chatgpt-account-id") ?? "";
				return new Response(JSON.stringify(payload), { status: 200 });
			},
		});
		assert.equal(seenUrl, "https://chatgpt.com/backend-api/wham/usage");
		assert.equal(seenAuthorization, "Bearer secret-access-token");
		assert.equal(seenAccount, "acct-local");
		assert.equal(JSON.stringify(snapshot).includes("secret-access-token"), false);
		assert.equal(JSON.stringify(snapshot).includes("acct-local"), false);
	});

	it("does not include an upstream response body in an error", async () => {
		await assert.rejects(
			fetchQuota({
				apiKey: "secret-access-token",
				fetchImpl: async () => new Response("sensitive upstream body", { status: 401 }),
			}),
			(error: Error) => error.message === "Codex usage request failed (401)",
		);
	});
});
