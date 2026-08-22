#!/usr/bin/env node
/**
 * Watch what the page logs while something happens.
 *
 * Console output and failed requests exist only while someone is listening,
 * and each command here is its own process -- so there is nothing to ask for
 * afterwards. This runs the action itself, with the listeners already on.
 *
 * Usage:
 *   node console.mjs --eval '<expression>' [--for <ms>]
 *   node console.mjs --for 5000              # just watch
 */
import { connect, explain, runnable } from "./browser.mjs";

const args = process.argv.slice(2);
const at = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const expression = at("--eval");
const duration = Number(at("--for") ?? 3000);

let session;
try {
	session = await connect();
	const lines = [];
	session.page.on("console", (message) => lines.push(`${message.type()}: ${message.text()}`));
	session.page.on("pageerror", (error) => lines.push(`uncaught: ${error.message}`));
	session.page.on("requestfailed", (request) => {
		lines.push(`request failed: ${request.url().slice(0, 90)} — ${request.failure()?.errorText}`);
	});

	if (expression) {
		await session.page.evaluate(runnable(expression))
			.catch((error) => lines.push(`the expression threw: ${error.message.split("\n")[0]}`));
	}
	await session.page.waitForTimeout(duration);

	if (lines.length === 0) console.log(`nothing logged in ${duration}ms`);
	else for (const line of lines) console.log(line);
} catch (error) {
	console.error(explain(error));
	process.exitCode = 1;
} finally {
	await session?.done();
}
