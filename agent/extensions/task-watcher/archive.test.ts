import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { TaskArchive } from "./archive.ts";

test("archives terminal task metadata and prunes old entries", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pi-task-watcher-"));
	let now = 10_000;
	const archive = new TaskArchive({ path: join(directory, "archive.jsonl"), now: () => now, retentionMs: 1_000, maxEntries: 2 });

	await archive.append({ id: "old", label: "old", state: "succeeded", startedAt: 1, updatedAt: 1, finishedAt: 1, exitCode: 0 });
	await archive.append({ id: "new-a", label: "new-a", state: "failed", startedAt: 9_100, updatedAt: 9_500, finishedAt: 9_500, exitCode: 1 });
	await archive.append({ id: "new-b", label: "new-b", state: "cancelled", startedAt: 9_200, updatedAt: 9_600, finishedAt: 9_600, exitCode: null });
	await archive.append({ id: "new-c", label: "new-c", state: "succeeded", startedAt: 9_300, updatedAt: 9_700, finishedAt: 9_700, exitCode: 0 });

	assert.deepEqual((await archive.list()).map((task) => task.id), ["new-c", "new-b"]);
	assert.match(await readFile(join(directory, "archive.jsonl"), "utf8"), /new-c/);
	assert.doesNotMatch(await readFile(join(directory, "archive.jsonl"), "utf8"), /old/);
});
