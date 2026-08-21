/**
 * Nothing happens on a machine without Moshi.
 *
 * Run: pnpm test
 *
 * The other tests exercise the extension as if Moshi were there. This one
 * checks the promise made to everyone else: no handlers, no command, no timer
 * and no request on a host that never paired. The guard is a single existsSync
 * at load, which is easy to lose in a later edit and impossible to notice —
 * the symptom on someone else's machine would be a slash command they never
 * asked for and a failing request after every turn.
 *
 * Loading the module is the only way to observe this, and the path it checks is
 * fixed at load from $HOME, so each case needs its own process.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const INDEX = join(dirname(fileURLToPath(import.meta.url)), "index.ts");

/** What the extension asks pi for, when loaded against the given home. */
function registrations(home: string): string[] {
	const script = `
		const mod = await import(${JSON.stringify(INDEX)});
		const calls = [];
		mod.default({
			on: (name) => calls.push("on:" + name),
			registerCommand: (name) => calls.push("command:" + name),
			registerTool: (tool) => calls.push("tool:" + tool.name),
			registerShortcut: (key) => calls.push("shortcut:" + key),
		});
		process.stdout.write(JSON.stringify(calls));
	`;
	const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
		env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: join(home, "agent") },
		encoding: "utf8",
	});
	assert.equal(result.status, 0, result.stderr);
	return JSON.parse(result.stdout);
}

function home(paired: boolean): string {
	const dir = mkdtempSync(join(tmpdir(), "moshi-push-"));
	if (paired) {
		mkdirSync(join(dir, ".config", "moshi"), { recursive: true });
		writeFileSync(
			join(dir, ".config", "moshi", "secrets.json"),
			JSON.stringify({ "host-id": "host_test", "host-secret": "secret_test" }),
		);
	}
	return dir;
}

describe("without Moshi", () => {
	it("registers nothing at all", () => {
		const dir = home(false);
		try {
			assert.deepEqual(registrations(dir), []);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("with Moshi paired", () => {
	it("subscribes to the turn lifecycle and offers the command", () => {
		const dir = home(true);
		try {
			const calls = registrations(dir);
			assert.deepEqual(calls, [
				"on:session_start",
				"on:agent_start",
				"on:agent_end",
				"on:agent_settled",
				"command:moshi-push",
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
