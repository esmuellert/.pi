/**
 * The contract with Moshi's server, which lives on their machine.
 *
 * Run: pnpm test
 *
 * `POST /api/v1/hosts/:hostId/events` validates against an exact union and,
 * when a value falls outside it, answers with the entire schema. That reply is
 * the source for the constants below — the published docs show a nine-field
 * example, not the accepted set, so without this the first sign of a field
 * Moshi does not accept would be a 400 that nobody sees, from a detached send
 * that must never raise.
 *
 * The behavioural half of the contract cannot be asserted offline and is
 * recorded here instead, from ~20 probes against the live API:
 *
 *   - Only `approval_required` and `error` produce a visible notification.
 *     `task_complete`, `info`, `session_ended`, `silent: false` and every
 *     `eventType` leave the phone silent. `silent: true` does suppress, so the
 *     field is read — it just cannot force delivery.
 *   - A session's card shows the state of the last event received, which is
 *     why the correction has to come second rather than first.
 *   - Cloudflare fronts the API and answers 403 to some default user agents.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEvents, DEFAULT_CONFIG, eventsUrl, type Turn } from "./event.ts";

/** Verbatim from the server's own validation reply. */
const SCHEMA = {
	required: ["source", "eventType", "sessionId", "category", "title", "message", "eventId"],
	properties: [
		"source",
		"eventType",
		"sessionId",
		"category",
		"title",
		"message",
		"eventId",
		"threadId",
		"turnId",
		"metadata",
		"projectName",
		"terminalKind",
		"tmuxSession",
		"tmuxWindow",
		"tmuxPane",
		"zellijSession",
		"zellijPane",
		"herdrSession",
		"herdrPane",
		"herdrWorkspaceId",
		"herdrWorkspace",
		"herdrTabId",
		"herdrTab",
		"modelName",
		"toolName",
		"contextRemaining",
		"pendingActionId",
		"expiresAt",
		"silent",
		"liveActivity",
		"accountId",
		"hostName",
	],
	source: ["claude", "codex", "opencode", "gemini", "antigravity", "kimi", "qwen", "cursor", "grok", "pi", "omp", "hermes"],
	eventType: ["user_prompt", "pre_tool", "post_tool", "notification", "stop", "agent_turn_complete"],
	category: [
		"approval_required",
		"task_complete",
		"tool_running",
		"tool_finished",
		"info",
		"error",
		"session_started",
		"session_ended",
	],
	liveActivityAction: ["auto", "upsert", "end", "none"],
} as const;

/** The categories that reach the phone. The whole design rests on this pair. */
const RINGS = ["approval_required", "error"] as const;

const turn: Turn = {
	sessionId: "01a0213e-66a5-7cec-898a-a638e855c080",
	project: "Downloads",
	summary: "Refactored the parser and every test passes.",
	durationMs: 133_000,
	toolCalls: 12,
	model: "claude-opus-5",
	contextRemaining: 62,
	hostName: "Mac",
	terminal: {
		terminalKind: "herdr",
		herdrSession: "default",
		herdrWorkspaceId: "w6",
		herdrPane: "w6:p1",
		herdrTabId: "w6:t1",
	},
	now: 1_787_270_808_000,
};

describe("host-event schema", () => {
	const events = buildEvents(turn, DEFAULT_CONFIG);

	it("sends both events", () => {
		assert.equal(events.length, 2);
	});

	for (const [index, event] of events.entries()) {
		const record = event as unknown as Record<string, unknown>;

		it(`event ${index + 1} carries every required field`, () => {
			for (const key of SCHEMA.required) {
				assert.ok(typeof record[key] === "string" && record[key], `missing ${key}`);
			}
		});

		it(`event ${index + 1} invents no field the server would reject`, () => {
			// additionalProperties is false on this branch of the union.
			for (const key of Object.keys(record)) {
				assert.ok(SCHEMA.properties.includes(key as never), `unknown field ${key}`);
			}
		});

		it(`event ${index + 1} stays inside every enum`, () => {
			assert.ok(SCHEMA.source.includes(record.source as never), `source ${record.source}`);
			assert.ok(SCHEMA.eventType.includes(record.eventType as never), `eventType ${record.eventType}`);
			assert.ok(SCHEMA.category.includes(record.category as never), `category ${record.category}`);
			const action = (record.liveActivity as { action?: string } | undefined)?.action;
			assert.ok(SCHEMA.liveActivityAction.includes(action as never), `liveActivity.action ${action}`);
		});

		it(`event ${index + 1} keeps contextRemaining an integer within 0..100`, () => {
			const value = record.contextRemaining;
			assert.equal(typeof value, "number");
			assert.ok(Number.isInteger(value as number), `not an integer: ${value}`);
			assert.ok((value as number) >= 0 && (value as number) <= 100, `out of range: ${value}`);
		});
	}

	it("uses a category that actually rings for the first event", () => {
		// If this ever has to change, the phone has stopped making a sound.
		assert.ok(RINGS.includes(events[0]?.category as never), `${events[0]?.category} does not ring`);
	});

	it("corrects the card with the category that reads COMPLETED, after the ring", () => {
		assert.equal(events[1]?.category, "task_complete");
		assert.equal(events[0]?.sessionId, events[1]?.sessionId);
	});
});

describe("endpoint", () => {
	it("addresses the paired host", () => {
		assert.equal(
			eventsUrl("host_00000000000000000000000000000000"),
			"https://api.getmoshi.app/api/v1/hosts/host_00000000000000000000000000000000/events",
		);
	});

	it("escapes a host id rather than pasting it into a path", () => {
		assert.equal(eventsUrl("a/b"), "https://api.getmoshi.app/api/v1/hosts/a%2Fb/events");
	});
});
