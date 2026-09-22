import assert from "node:assert/strict";
import test from "node:test";

import { buildRestartArgs, detectLoadedPiVersion, isPiVersionChanged, parsePiVersion } from "./restart.ts";

test("parses the version printed by pi", () => {
	assert.equal(parsePiVersion("0.85.1\n"), "0.85.1");
	assert.equal(parsePiVersion("v0.85.2\n"), "0.85.2");
	assert.equal(parsePiVersion("not a version"), undefined);
});

test("uses the running Pi executable version after the workspace dependency is upgraded", () => {
	assert.equal(
		detectLoadedPiVersion(
			"/Users/yanuo/Library/pnpm/global/5/.pnpm/@earendil-works+pi-coding-agent@0.85.1_ws@8.21.3/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
			"0.87.0",
		),
		"0.85.1",
	);
	assert.equal(detectLoadedPiVersion("/tmp/pi/cli.js", "0.87.0"), "0.87.0");
});

test("detects installed version drift without treating a missing probe as an upgrade", () => {
	assert.equal(isPiVersionChanged("0.85.1", "0.85.2"), true);
	assert.equal(isPiVersionChanged("0.85.1", "0.85.1"), false);
	assert.equal(isPiVersionChanged("0.85.1", undefined), false);
});

test("restarts the current session instead of replaying the startup prompt", () => {
	assert.deepEqual(
		buildRestartArgs(
			["--model", "gpt-5.6-sol", "--tui-mode", "fullscreen", "initial prompt"],
			"/tmp/session.jsonl",
		),
		["--model", "gpt-5.6-sol", "--tui-mode", "fullscreen", "--session", "/tmp/session.jsonl"],
	);
});

test("replaces old session selectors and keeps explicit extensions", () => {
	assert.deepEqual(
		buildRestartArgs(
			["--continue", "--extension", "./local.ts", "--session=/tmp/old.jsonl"],
			"/tmp/current.jsonl",
		),
		["--extension", "./local.ts", "--session", "/tmp/current.jsonl"],
	);
});

test("preserves no-session when there is no resumable session", () => {
	assert.deepEqual(buildRestartArgs(["--no-session", "--tui-mode", "regular"], ""), [
		"--tui-mode",
		"regular",
		"--no-session",
	]);
});
