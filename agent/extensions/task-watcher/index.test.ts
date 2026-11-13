import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import taskWatcher from "./index.ts";

test("registers non-blocking task controls without a wait tool", () => {
	const tools: Array<{ name: string; description?: string; promptGuidelines?: string[] }> = [];
	const pi = {
		events: { emit: () => undefined },
		on: () => undefined,
		registerCommand: () => undefined,
		registerTool: (tool: (typeof tools)[number]) => tools.push(tool),
	} as unknown as ExtensionAPI;

	taskWatcher(pi);

	assert.deepEqual(tools.map((tool) => tool.name), [
		"start_watched_task",
		"get_watched_task",
		"cancel_watched_task",
	]);
	assert.equal(tools.some((tool) => tool.name === "wait_watched_task"), false);
	const start = tools[0]!;
	assert.match(start.description ?? "", /completion notification/);
	assert.ok(start.promptGuidelines?.some((guideline) => guideline.includes("sleep/setTimeout")));
});
