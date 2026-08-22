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

import { explain, runnable } from "./browser.mjs";

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
