import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import cdExtension from "./index.ts";

type CommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

test("uses only the replacement context after switching sessions", async () => {
	let handler: CommandHandler | undefined;
	cdExtension({
		registerCommand(name: string, options: { handler: CommandHandler }) {
			assert.equal(name, "cd");
			handler = options.handler;
		},
	} as unknown as ExtensionAPI);
	assert.ok(handler);

	const root = mkdtempSync(join(tmpdir(), "cd-command-"));
	const sourceDir = join(root, "source");
	const targetDir = join(root, "target");
	const source = join(root, "source.jsonl");
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	const oldNotifications: string[] = [];
	const newNotifications: string[] = [];
	let oldContextStale = false;
	let moved: string | undefined;

	try {
		process.env.PI_CODING_AGENT_DIR = join(root, "agent");
		mkdirSync(sourceDir);
		mkdirSync(targetDir);
		writeFileSync(
			source,
			`${JSON.stringify({
				type: "session",
				version: 3,
				id: "source",
				timestamp: "2026-01-01T00:00:00.000Z",
				cwd: sourceDir,
			})}\n`,
		);

		const ctx = {
			cwd: sourceDir,
			sessionManager: { getSessionFile: () => source },
			ui: {
				notify(message: string) {
					if (oldContextStale) throw new Error("old context used after replacement");
					oldNotifications.push(message);
				},
			},
			async switchSession(
				path: string,
				options: {
					withSession?: (next: { ui: { notify(message: string): void } }) => Promise<void>;
				},
			) {
				moved = path;
				oldContextStale = true;
				await options.withSession?.({
					ui: { notify: (message) => newNotifications.push(message) },
				});
				return { cancelled: false };
			},
		} as unknown as ExtensionCommandContext;

		await handler(targetDir, ctx);

		assert.deepEqual(oldNotifications, []);
		assert.deepEqual(newNotifications, [`Now in ${targetDir}`, `Original left at ${source}`]);
		assert.ok(moved && existsSync(moved), "the relocated session should survive a successful switch");
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(root, { recursive: true, force: true });
	}
});
