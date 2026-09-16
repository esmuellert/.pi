import assert from "node:assert/strict";
import { test } from "node:test";

import { elapsed, TaskRegistry } from "./task.ts";

test("formats task elapsed time", () => {
	assert.equal(elapsed(Date.now() - 5_000), "5s");
	assert.equal(elapsed(Date.now() - 125_000), "2m05s");
	assert.equal(elapsed(Date.now() - 3_720_000), "1h02m");
});

test("starts an asynchronous task and waits for its result", async () => {
	const registry = new TaskRegistry();
	const task = registry.start({
		label: "test task",
		command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify("console.log('done')")}`,
		cwd: process.cwd(),
	});

	assert.equal(task.state, "running");
	const finished = await registry.wait(task.id);
	assert.equal(finished.state, "succeeded");
	assert.equal(finished.exitCode, 0);
	assert.equal(finished.latestMessage, "done");
});

test("reports an unknown task without starting a process", async () => {
	const registry = new TaskRegistry();
	await assert.rejects(() => registry.wait("task-missing"), /Unknown watched task/);
});
