import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import taskWatcher from "./index.ts";

type ToolEntry = {
	name: string;
	description?: string;
	promptGuidelines?: string[];
	execute: (id: string, params: any, signal: AbortSignal | undefined, onUpdate: unknown, ctx: any) => Promise<any>;
};

function harness(options?: { notificationGraceMs?: number; startupProbeMs?: number }) {
	const tools = new Map<string, ToolEntry>();
	const handlers = new Map<string, Array<(event: any, ctx: ExtensionContext) => unknown>>();
	const sentMessages: string[] = [];
	const stateEvents: Array<{ running: number; pendingNotifications: number }> = [];
	let idle = true;

	const pi = {
		events: {
			emit: (name: string, payload: any) => {
				if (name === "task-watcher:state") stateEvents.push(payload);
			},
		},
		on: (name: string, handler: (event: any, ctx: ExtensionContext) => unknown) => {
			const list = handlers.get(name) ?? [];
			list.push(handler);
			handlers.set(name, list);
		},
		registerCommand: () => undefined,
		registerTool: (tool: ToolEntry) => tools.set(tool.name, tool),
		sendUserMessage: (text: string) => sentMessages.push(text),
	} as unknown as ExtensionAPI;

	const ctx = {
		cwd: process.cwd(),
		mode: "print",
		hasUI: false,
		isIdle: () => idle,
		ui: { setWidget: () => undefined, notify: () => undefined },
	} as unknown as ExtensionContext;

	taskWatcher(pi, options);

	const emit = async (name: string, event: any = {}) => {
		for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
	};

	return {
		tools,
		sentMessages,
		stateEvents,
		ctx,
		setIdle: (next: boolean) => { idle = next; },
		emit,
	};
}

test("registers non-blocking task controls without a wait tool", () => {
	const app = harness();
	assert.deepEqual([...app.tools.keys()], [
		"start_watched_task",
		"get_watched_task",
		"cancel_watched_task",
	]);
	assert.equal(app.tools.has("wait_watched_task"), false);
	const start = app.tools.get("start_watched_task")!;
	assert.match(start.description ?? "", /completion notification/);
	assert.ok(start.promptGuidelines?.some((guideline) => guideline.includes("sleep/setTimeout")));
});

test("returns an immediate error with full recent output when a command fails on startup", async () => {
	const app = harness({ notificationGraceMs: 20, startupProbeMs: 250 });
	await app.emit("session_start");
	try {
		const start = app.tools.get("start_watched_task")!;
		const result = await start.execute(
			"call-1",
			{
				label: "bad command",
				command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify("console.error('fatal: bad flag --nope\\nSee --help'); process.exit(2)")}`,
			},
			undefined,
			undefined,
			app.ctx,
		);

		assert.equal(result.isError, true);
		assert.equal(result.details.state, "failed");
		assert.equal(result.details.exitCode, 2);
		assert.match(result.content[0].text, /failed immediately during startup/);
		assert.match(result.content[0].text, /fatal: bad flag --nope/);
		assert.match(result.content[0].text, /See --help/);

		await new Promise((resolve) => setTimeout(resolve, 60));
		assert.deepEqual(app.sentMessages, [], "inline startup failure must not also send a duplicate notification");
	} finally {
		await app.emit("session_shutdown");
	}
});

test("defers completion notifications while the agent is busy and flushes them on agent_settled", async () => {
	const app = harness({ notificationGraceMs: 20, startupProbeMs: 30 });
	await app.emit("session_start");
	try {
		app.setIdle(false);
		const start = app.tools.get("start_watched_task")!;
		const started = await start.execute(
			"call-2",
			{
				label: "dies while agent is still replying",
				command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify("setTimeout(() => { console.error('line 1: root cause\\nline 2: try --help'); process.exit(1); }, 80)")}`,
			},
			undefined,
			undefined,
			app.ctx,
		);
		assert.equal(started.details.state, "running");

		// Wait past task exit + grace timer while agent is still busy (!isIdle)
		await new Promise((resolve) => setTimeout(resolve, 160));
		assert.deepEqual(app.sentMessages, [], "must not fire while busy");
		assert.equal(app.stateEvents.at(-1)?.pendingNotifications, 1, "keeps pending count visible to auto-upgrade");

		// Agent finishes its turn and settles -> queued failure notice is delivered
		app.setIdle(true);
		await app.emit("agent_settled");

		assert.equal(app.sentMessages.length, 1);
		assert.match(app.sentMessages[0]!, /finished with state: failed/);
		assert.match(app.sentMessages[0]!, /line 1: root cause/);
		assert.match(app.sentMessages[0]!, /line 2: try --help/);
		assert.equal(app.stateEvents.at(-1)?.pendingNotifications, 0);
	} finally {
		await app.emit("session_shutdown");
	}
});
