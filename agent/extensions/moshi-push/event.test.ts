/**
 * The text and the decisions, with no phone and no network in sight.
 *
 * Run: pnpm test
 *
 * contract.test.ts covers the shape Moshi's API demands. This covers what a
 * turn turns into: what the notification says, when it is worth sending, and
 * the two-event sequence that leaves the card reading COMPLETED.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	assistantText,
	buildEvents,
	clamp,
	DEFAULT_CONFIG,
	eventMessage,
	eventTitle,
	formatDuration,
	lastAssistantText,
	parseConfig,
	parseCredentials,
	shouldNotify,
	terminalFromEnv,
	type Turn,
} from "./event.ts";

const turn = (overrides: Partial<Turn> = {}): Turn => ({
	sessionId: "01a0213e-66a5-7cec-898a-a638e855c080",
	project: "Downloads",
	summary: "Refactored the parser and every test passes.",
	durationMs: 133_000,
	toolCalls: 12,
	now: 1_787_270_808_000,
	...overrides,
});

describe("credentials", () => {
	it("reads Moshi's own field names", () => {
		const creds = parseCredentials({
			"host-display-name": "Mac",
			"host-id": "host_abc",
			"host-secret": "secret_xyz",
			"pairing-token": "unused",
		});
		assert.deepEqual(creds, { hostId: "host_abc", hostSecret: "secret_xyz" });
	});

	it("treats a half-written file as unpaired rather than as credentials", () => {
		assert.equal(parseCredentials({ "host-id": "host_abc" }), undefined);
		assert.equal(parseCredentials({ "host-id": "", "host-secret": "s" }), undefined);
		assert.equal(parseCredentials("nonsense"), undefined);
		assert.equal(parseCredentials(undefined), undefined);
	});
});

describe("config", () => {
	it("defaults when the file is missing, empty or nonsense", () => {
		assert.deepEqual(parseConfig(undefined), DEFAULT_CONFIG);
		assert.deepEqual(parseConfig({}), DEFAULT_CONFIG);
		assert.deepEqual(parseConfig("nope"), DEFAULT_CONFIG);
	});

	it("keeps the defaults for fields it cannot use, instead of switching off", () => {
		const parsed = parseConfig({ minSeconds: "30", onlyWhenLocked: true, fixDelayMs: -1 });
		assert.equal(parsed.minSeconds, DEFAULT_CONFIG.minSeconds);
		assert.equal(parsed.fixDelayMs, DEFAULT_CONFIG.fixDelayMs);
		assert.equal(parsed.onlyWhenLocked, true);
		assert.equal(parsed.enabled, true);
	});
});

describe("assistant text", () => {
	it("keeps text blocks and drops reasoning", () => {
		const message = {
			role: "assistant",
			content: [
				{ type: "thinking", text: "the user probably wants" },
				{ type: "text", text: "Done.\n\nTests   pass." },
			],
		};
		assert.equal(assistantText(message), "Done. Tests pass.");
	});

	it("reads a plain string body", () => {
		assert.equal(assistantText({ role: "assistant", content: "  hi  there " }), "hi there");
	});

	it("takes the last assistant message with something to say", () => {
		const messages = [
			{ role: "assistant", content: "first" },
			{ role: "toolResult", content: "ignored" },
			{ role: "assistant", content: "second" },
			// A tool-call-only message has no text and must not blank the summary.
			{ role: "assistant", content: [{ type: "toolCall", id: "x" }] },
		];
		assert.equal(lastAssistantText(messages), "second");
		assert.equal(lastAssistantText([]), "");
		assert.equal(lastAssistantText(undefined), "");
	});
});

describe("wording", () => {
	it("formats durations at the scale a person reads", () => {
		assert.equal(formatDuration(0), "0s");
		assert.equal(formatDuration(45_000), "45s");
		assert.equal(formatDuration(60_000), "1m");
		assert.equal(formatDuration(133_000), "2m 13s");
		assert.equal(formatDuration(3_600_000), "1h");
		assert.equal(formatDuration(4_500_000), "1h 15m");
	});

	it("puts the three facts worth reading in the headline", () => {
		assert.equal(eventTitle(turn()), "Downloads · 12 tools · 2m 13s");
		assert.equal(eventMessage(turn()), "Refactored the parser and every test passes.");
	});

	it("counts one tool without pluralising it", () => {
		assert.equal(eventTitle(turn({ toolCalls: 1 })), "Downloads · 1 tool · 2m 13s");
	});

	it("drops the segments a turn did not earn", () => {
		assert.equal(eventTitle(turn({ toolCalls: 0 })), "Downloads · 2m 13s");
		assert.equal(eventTitle(turn({ toolCalls: 0, durationMs: 0 })), "Downloads");
	});

	it("says something when the turn produced no prose", () => {
		assert.equal(eventMessage(turn({ summary: "", durationMs: 0 })), "Turn finished");
	});

	it("gives the whole body to what was said, since the numbers are in the title", () => {
		const message = eventMessage(turn({ summary: "x".repeat(400) }));
		assert.ok(message.length <= 200, `message was ${message.length} chars`);
		assert.ok(message.endsWith("…"));
	});

	it("keeps a long project name inside the title limit", () => {
		const title = eventTitle(turn({ project: "p".repeat(120) }));
		assert.ok(title.length <= 80, `title was ${title.length} chars`);
	});

	it("clamps without inventing an ellipsis it does not need", () => {
		assert.equal(clamp("short", 10), "short");
		assert.equal(clamp("abcdefghij", 5), "abcd…");
	});
});

describe("whether to send", () => {
	it("sends by default", () => {
		assert.equal(shouldNotify(turn(), DEFAULT_CONFIG, undefined), true);
	});

	it("respects the off switch", () => {
		assert.equal(shouldNotify(turn(), { ...DEFAULT_CONFIG, enabled: false }, undefined), false);
	});

	it("skips turns shorter than the floor, and keeps the ones at it", () => {
		const config = { ...DEFAULT_CONFIG, minSeconds: 30 };
		assert.equal(shouldNotify(turn({ durationMs: 29_999 }), config, undefined), false);
		assert.equal(shouldNotify(turn({ durationMs: 30_000 }), config, undefined), true);
	});

	it("stays quiet at an unlocked Mac, and speaks up when the lock state is unknown", () => {
		const config = { ...DEFAULT_CONFIG, onlyWhenLocked: true };
		assert.equal(shouldNotify(turn(), config, false), false);
		assert.equal(shouldNotify(turn(), config, true), true);
		// Unreadable lock state must not be able to swallow a notification.
		assert.equal(shouldNotify(turn(), config, undefined), true);
	});
});

describe("the two events", () => {
	it("rings first and corrects the card second, on one session row", () => {
		const [ring, settle] = buildEvents(turn(), DEFAULT_CONFIG);
		assert.equal(ring?.category, "error");
		assert.equal(settle?.category, "task_complete");
		assert.equal(ring?.sessionId, settle?.sessionId);
		// Same row, different events: Moshi merges by session and dedupes by id.
		assert.notEqual(ring?.eventId, settle?.eventId);
		assert.equal(ring?.title, settle?.title);
		assert.equal(ring?.message, settle?.message);
	});

	it("sends only the ring when the correction is switched off", () => {
		const events = buildEvents(turn(), { ...DEFAULT_CONFIG, fixStatus: false });
		assert.equal(events.length, 1);
		assert.equal(events[0]?.category, "error");
	});

	it("leaves the Live Activity to moshi-hook", () => {
		for (const event of buildEvents(turn(), DEFAULT_CONFIG)) {
			assert.deepEqual(event.liveActivity, { action: "none" });
		}
	});

	it("carries the pane so the notification opens where the turn ran", () => {
		const [ring] = buildEvents(turn({ terminal: terminalFromEnv({ HERDR_ENV: "1", HERDR_WORKSPACE_ID: "w6", HERDR_PANE_ID: "w6:p1", HERDR_TAB_ID: "w6:t1" }) }), DEFAULT_CONFIG);
		assert.equal(ring?.terminalKind, "herdr");
		assert.equal(ring?.herdrWorkspaceId, "w6");
		assert.equal(ring?.herdrPane, "w6:p1");
		assert.equal(ring?.herdrSession, "default");
	});

	it("rounds context into the percentage the card can draw", () => {
		const [ring] = buildEvents(turn({ contextRemaining: 61.6 }), DEFAULT_CONFIG);
		assert.equal(ring?.contextRemaining, 62);
		const [clamped] = buildEvents(turn({ contextRemaining: 140 }), DEFAULT_CONFIG);
		assert.equal(clamped?.contextRemaining, 100);
	});

	it("omits what it does not know rather than sending empty strings", () => {
		const [ring] = buildEvents(turn(), DEFAULT_CONFIG);
		assert.ok(!("modelName" in (ring as object)));
		assert.ok(!("hostName" in (ring as object)));
		assert.ok(!("terminalKind" in (ring as object)));
		assert.ok(!("contextRemaining" in (ring as object)));
	});
});

describe("terminal detection", () => {
	it("finds nothing outside a multiplexer", () => {
		assert.equal(terminalFromEnv({}), undefined);
		assert.equal(terminalFromEnv({ HERDR_ENV: "0" }), undefined);
		// Inside tmux but without a resolved session name there is nothing to open.
		assert.equal(terminalFromEnv({ TMUX: "/tmp/tmux-501/default,1,0" }), undefined);
	});

	it("reads tmux when that is what is running", () => {
		const ref = terminalFromEnv({ TMUX: "/tmp/x", TMUX_SESSION_NAME: "work", TMUX_PANE: "%3" });
		assert.equal(ref?.terminalKind, "tmux");
		assert.equal(ref?.tmuxSession, "work");
		assert.equal(ref?.tmuxPane, "%3");
	});
});
