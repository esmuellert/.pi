import assert from "node:assert/strict";
import test from "node:test";
import {
	installHerdrClipboardRelay,
	MAX_OSC52_ENCODED_LENGTH,
	osc52Sequence,
	shouldRelayClipboard,
	type TextClipboard,
} from "./bridge.ts";

function fakeClipboard(events: string[]): TextClipboard {
	return {
		async setText(text: string) {
			events.push(`native:${text}`);
		},
	};
}

test("recognizes Herdr without pretending the pane is an SSH process", () => {
	assert.equal(shouldRelayClipboard({}), false);
	assert.equal(shouldRelayClipboard({ HERDR_ENV: "1" }), true);
});

test("writes natively before relaying the same text through OSC 52", async () => {
	const events: string[] = [];
	const clipboard = fakeClipboard(events);
	const restore = installHerdrClipboardRelay(
		clipboard,
		(sequence) => events.push(`relay:${sequence}`),
		{ HERDR_ENV: "1" },
	);

	await clipboard.setText("hello");

	assert.deepEqual(events, ["native:hello", `relay:\u001b]52;c;aGVsbG8=\u0007`]);
	restore();
});

test("does not alter clipboard behavior outside Herdr", async () => {
	const events: string[] = [];
	const clipboard = fakeClipboard(events);
	const restore = installHerdrClipboardRelay(clipboard, (sequence) => events.push(sequence), {});

	await clipboard.setText("local");

	assert.deepEqual(events, ["native:local"]);
	restore();
});

test("restores the original method and does not wrap twice", async () => {
	const events: string[] = [];
	const clipboard = fakeClipboard(events);
	const original = clipboard.setText;
	const restoreFirst = installHerdrClipboardRelay(clipboard, (sequence) => events.push(`first:${sequence}`), {
		HERDR_ENV: "1",
	});
	const restoreSecond = installHerdrClipboardRelay(clipboard, (sequence) => events.push(`second:${sequence}`), {
		HERDR_ENV: "1",
	});

	await clipboard.setText("once");
	assert.equal(events.filter((event) => event.startsWith("first:")).length, 1);
	assert.equal(events.filter((event) => event.startsWith("second:")).length, 0);

	restoreSecond();
	restoreFirst();
	assert.equal(clipboard.setText, original);
});

test("still relays when the native write fails, then preserves that failure", async () => {
	const events: string[] = [];
	const clipboard: TextClipboard = {
		async setText() {
			throw new Error("native failed");
		},
	};
	const restore = installHerdrClipboardRelay(clipboard, (sequence) => events.push(sequence), {
		HERDR_ENV: "1",
	});

	await assert.rejects(async () => clipboard.setText("fallback"), /native failed/);
	assert.deepEqual(events, [`\u001b]52;c;ZmFsbGJhY2s=\u0007`]);
	restore();
});

test("does not relay payloads above pi's OSC 52 limit", async () => {
	const events: string[] = [];
	const clipboard = fakeClipboard(events);
	const restore = installHerdrClipboardRelay(clipboard, (sequence) => events.push(sequence), {
		HERDR_ENV: "1",
	});
	const oversized = "x".repeat(MAX_OSC52_ENCODED_LENGTH);

	assert.equal(osc52Sequence(oversized), undefined);
	await clipboard.setText(oversized);
	assert.deepEqual(events, [`native:${oversized}`]);
	restore();
});
