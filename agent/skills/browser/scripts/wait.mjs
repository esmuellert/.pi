#!/usr/bin/env node
/**
 * Wait for the page to reach a state, instead of sleeping and hoping.
 *
 * --text is the common case: a page that loads its content late says so with
 * words. --gone is its opposite, for spinners.
 *
 * Usage:
 *   node wait.mjs --text "Hello World!"   [--timeout <ms>]
 *   node wait.mjs --gone "Loading..."     [--timeout <ms>]
 *   node wait.mjs --idle                  [--timeout <ms>]
 */
import { connect, explain } from "./browser.mjs";

const args = process.argv.slice(2);
const at = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const text = at("--text");
const gone = at("--gone");
const timeout = Number(at("--timeout") ?? 15_000);

if (!text && !gone && !args.includes("--idle")) {
	console.error(`usage: node wait.mjs --text "..." | --gone "..." | --idle [--timeout <ms>]`);
	process.exit(1);
}

const started = Date.now();
const session = await connect();
try {
	if (text) {
		await session.page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
		console.log(`"${text}" appeared after ${Date.now() - started}ms`);
	} else if (gone) {
		await session.page.getByText(gone, { exact: false }).first().waitFor({ state: "hidden", timeout });
		console.log(`"${gone}" went away after ${Date.now() - started}ms`);
	} else {
		await session.page.waitForLoadState("networkidle", { timeout });
		console.log(`network went quiet after ${Date.now() - started}ms`);
	}
	console.log("take a snapshot to see the page now");
} catch (error) {
	console.error(`still waiting after ${Date.now() - started}ms: ${explain(error)}`);
	process.exitCode = 1;
} finally {
	await session.done();
}
