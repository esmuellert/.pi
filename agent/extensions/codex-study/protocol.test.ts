import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isCodexUsageState } from "./protocol.ts";

describe("Codex footer protocol", () => {
	it("accepts only complete verified snapshots or the disabled state", () => {
		assert.equal(isCodexUsageState({ verified: false, quota: null }), true);
		assert.equal(isCodexUsageState({ verified: false, quota: {} }), false);
		assert.equal(isCodexUsageState({ verified: true, quota: null }), false);
		assert.equal(isCodexUsageState({
			verified: true,
			quota: {
				fetchedAt: 1,
				planType: "plus",
				primary: { usedPercent: 10, windowSeconds: 18_000, resetAt: null },
				secondary: { usedPercent: 20, windowSeconds: 604_800, resetAt: 2 },
			},
		}), true);
		assert.equal(isCodexUsageState({
			verified: true,
			quota: {
				fetchedAt: 1,
				primary: { usedPercent: "10", windowSeconds: 18_000, resetAt: null },
				secondary: { usedPercent: 20, windowSeconds: 604_800, resetAt: 2 },
			},
		}), false);
	});
});
