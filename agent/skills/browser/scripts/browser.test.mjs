/**
 * Tests for the parts that can be checked without a browser.
 *
 * Driving Chrome is covered by using it; what is worth pinning here is the
 * string handling that stands between a reader and a working command, because
 * each of these has been wrong at least once.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { explain, outputDir, runnable, stamp } from "./browser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const scripts = readdirSync(HERE).filter((name) => name.endsWith(".mjs") && !name.endsWith(".test.mjs"));

test("a bare expression is passed through untouched", () => {
	// Playwright evaluates a string as an expression. Wrapping "1+1" into an
	// arrow function returns undefined, which is what it did before this.
	assert.equal(runnable("1+1"), "1+1");
	assert.equal(runnable("document.title"), "document.title");
});

test("a body with statements is wrapped into a call", () => {
	assert.equal(runnable("const a = 2; return a;"), "(async () => { const a = 2; return a; })()");
	assert.match(runnable("return 42"), /^\(async \(\) => \{ return 42 \}\)\(\)$/);
});

test("explain keeps the first line and drops Playwright's call log", () => {
	const error = new Error("locator.click: Timeout 10000ms exceeded.\nCall log:\n  - waiting for locator\n  - retrying");
	const said = explain(error);
	assert.match(said, /^locator\.click: Timeout/);
	assert.doesNotMatch(said, /retrying/);
});

test("explain surfaces what an action was waiting for", () => {
	const error = new Error([
		"locator.click: Timeout 10000ms exceeded.",
		"Call log:",
		"  - waiting for locator('[data-pi-uid=\"7\"]')",
		"  - element is not visible",
	].join("\n"));
	const said = explain(error);
	assert.match(said, /it was: locator/);
	assert.match(said, /last check: element is not visible/);
});

test("explain strips the colours Playwright puts in its log", () => {
	const error = new Error("locator.click: Timeout 10000ms exceeded.\nCall log:\n  - element is not visible\u001B[22m");
	assert.doesNotMatch(explain(error), /\u001B/);
});

test("explain passes an ordinary error through", () => {
	assert.equal(explain(new Error("no such file")), "no such file");
});

test("every script reports failure the same way", () => {
	// A script that prints a raw Playwright error buries the useful line under
	// forty lines of call log.
	for (const name of scripts) {
		const source = readFileSync(join(HERE, name), "utf-8");
		if (!source.includes("console.error")) continue;
		if (name === "browser.mjs" || name === "act.mjs" || name === "start.mjs") continue;
		assert.ok(
			source.includes("explain(error)"),
			`${name} should report failures with explain(), so a call log does not drown the message`,
		);
	}
});

test("every script that takes a flag with a value parses it safely", () => {
	// `args.indexOf` returns -1 when a flag is absent, and `index !== -1 + 1`
	// then excludes argument 0 -- which is where the value usually is. This has
	// been the bug twice.
	for (const name of scripts) {
		const source = readFileSync(join(HERE, name), "utf-8");
		const risky = source.match(/index !== \w+At \+ 1/g);
		assert.equal(risky, null, `${name} compares against an index that is -1 + 1 when the flag is absent`);
	}
});

test("the uid attribute is a single source of truth", () => {
	// Two spellings of the attribute would mean a snapshot nothing can act on.
	const literal = /data-pi-uid/;
	for (const name of scripts) {
		if (name === "act.mjs") continue;
		const source = readFileSync(join(HERE, name), "utf-8");
		assert.ok(
			!literal.test(source) || source.includes("UID_ATTRIBUTE"),
			`${name} writes the attribute name out; import UID_ATTRIBUTE instead`,
		);
	}
});

test("snapshots are kept apart per session", () => {
	// Two agents share one browser. They must not share one uids.json: the
	// second snapshot would overwrite the first, and the first agent's next
	// click would land on an element it never saw. Checked by doing it once --
	// a fill aimed at a combobox went into a textbox on another tab.
	const mine = withSession("aaaaaaaa-1111", () => outputDir());
	const theirs = withSession("bbbbbbbb-2222", () => outputDir());
	assert.notEqual(mine, theirs);
});

test("without a session id there is still somewhere to write", () => {
	const anonymous = withSession(undefined, () => outputDir());
	assert.match(anonymous, /pi-browser/);
});

test("two processes taking a snapshot at once write different files", () => {
	// This is the collision that happened: two commands, same second, one file.
	// Within one process the clock may not have moved, so what has to differ is
	// the part that comes from the process itself.
	const mine = stamp();
	assert.match(mine, new RegExp(`-${process.pid}$`), "the stamp should carry the process id");
	assert.notEqual(mine.replace(`-${process.pid}`, "-1"), mine);
});

/** Run something with PI_SESSION_ID set, and put the environment back. */
function withSession(id, work) {
	const before = process.env.PI_SESSION_ID;
	if (id === undefined) delete process.env.PI_SESSION_ID;
	else process.env.PI_SESSION_ID = id;
	try {
		return work();
	} finally {
		if (before === undefined) delete process.env.PI_SESSION_ID;
		else process.env.PI_SESSION_ID = before;
	}
}

test("a handle records a tab id, not a position", () => {
	// Closing a tab moves every later tab down by one. A handle that stored a
	// position would start naming a different page, silently -- and with more
	// than one agent, another closing a tab is ordinary.
	const source = readFileSync(join(HERE, "snapshot.mjs"), "utf-8");
	assert.match(source, /tab: pageId/, "snapshot should store the target id with each handle");
	assert.doesNotMatch(source, /pages\.indexOf\(session\.page\)/, "a position must not be stored");
});
