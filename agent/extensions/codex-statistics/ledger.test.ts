import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { ExtensionContext, TurnEndEvent } from "@earendil-works/pi-coding-agent";

import { addTurn, defaultDataDir, finishReply, JsonlLedger, startReply } from "./ledger.ts";
function context(): ExtensionContext {
	return {
		model: {
			provider: "openai-codex",
			api: "openai-codex-responses",
			id: "gpt-5.6-sol",
			contextWindow: 272_000,
		} as ExtensionContext["model"],
		thinkingLevel: "max",
		sessionManager: {
			getSessionId: () => "private-session-uuid",
		} as ExtensionContext["sessionManager"],
	} as ExtensionContext;
}

function turn(): TurnEndEvent {
	return {
		type: "turn_end",
		turnIndex: 0,
		message: {
			role: "assistant",
			provider: "openai-codex",
			api: "openai-codex-responses",
			model: "gpt-5.6-sol",
			responseModel: "gpt-5.6-sol-2026-08-01",
			providerThinkingLevel: "max",
			content: [
				{ type: "text", text: "SECRET RESPONSE" },
				{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "/secret/repo/file.ts" } },
			],
			usage: {
				input: 1_000,
				cacheRead: 8_000,
				cacheWrite: 200,
				output: 500,
				reasoning: 300,
				totalTokens: 9_700,
				cost: { input: 0.01, cacheRead: 0.02, cacheWrite: 0.03, output: 0.04, total: 0.1 },
			},
			stopReason: "toolUse",
			timestamp: 2_000,
		},
		toolResults: [{
			role: "toolResult",
			toolCallId: "call-1",
			toolName: "read",
			content: [{ type: "text", text: "SECRET TOOL RESULT" }],
			details: { path: "/secret/repo/file.ts" },
			isError: false,
			timestamp: 2_100,
			usage: {
				input: 10,
				cacheRead: 20,
				cacheWrite: 0,
				output: 5,
				totalTokens: 35,
				cost: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 },
			},
		}],
	} as TurnEndEvent;
}

describe("Codex JSONL ledger", () => {
	it("uses the platform data root and allows an explicit local override", () => {
		assert.equal(defaultDataDir({ XDG_DATA_HOME: "/data" }, "linux", "/home/user"), join("/data", "pi-codex-statistics"));
		assert.equal(defaultDataDir({ LOCALAPPDATA: "/local" }, "win32", "/home/user"), join("/local", "pi-codex-statistics"));
		assert.equal(defaultDataDir({ PI_CODEX_STATISTICS_DATA_DIR: "/chosen" }, "darwin", "/home/user"), "/chosen");
	});

	it("records numeric detail without conversation content or source paths", async () => {
		const draft = startReply(context(), "process-ref", 1_000, "reply-id");
		addTurn(draft, turn(), "max", 1_500, 2_200);
		const record = finishReply(draft, 2_400);

		assert.equal(record.totals.model.output, 500);
		assert.equal(record.totals.model.reasoning, 300, "reasoning remains a subset of output");
		assert.equal(record.totals.nestedTools.totalTokens, 35);
		assert.equal(record.turns[0]!.tools.requested[0], "read");
		assert.notEqual(record.sessionRef, "private-session-uuid");

		const serialized = JSON.stringify(record);
		for (const secret of ["SECRET RESPONSE", "SECRET TOOL RESULT", "/secret/repo/file.ts", "private-session-uuid"]) {
			assert.equal(serialized.includes(secret), false, secret);
		}

		const directory = await mkdtemp(join(tmpdir(), "pi-codex-statistics-"));
		try {
			const ledger = new JsonlLedger(directory);
			await ledger.append(record);
			await ledger.flush();
			const path = join(directory, "usage-1970-01-01.jsonl");
			const lines = (await readFile(path, "utf8")).trim().split("\n");
			assert.equal(lines.length, 1);
			assert.deepEqual(JSON.parse(lines[0]!), record);
			if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
