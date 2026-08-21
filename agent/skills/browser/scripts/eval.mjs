#!/usr/bin/env node
/**
 * Run JavaScript in the page. The escape hatch for whatever the other scripts
 * cannot express.
 *
 * Usage: node eval.mjs '<expression>' [--target <id>]
 *   node eval.mjs 'document.querySelectorAll("a").length'
 *   node eval.mjs 'await fetch("/api").then(r => r.json())'
 */
import { attach, currentPage, ensure } from "./cdp.mjs";

const args = process.argv.slice(2);
const targetAt = args.indexOf("--target");
const targetId = targetAt >= 0 ? args[targetAt + 1] : undefined;
const expression = args.find((a, i) => !a.startsWith("--") && !(targetAt >= 0 && i === targetAt + 1));
if (!expression) {
	console.error("usage: node eval.mjs '<expression>'");
	process.exit(1);
}

try {
	await ensure();
	const page = await currentPage(targetId);
	const { send, close } = await attach(page);
	const { result, exceptionDetails } = await send("Runtime.evaluate", {
		expression,
		returnByValue: true,
		awaitPromise: true,
		// So that `await` works at the top level, as it does in the console.
		replMode: true,
	});
	close();
	if (exceptionDetails) {
		console.error(exceptionDetails.exception?.description ?? exceptionDetails.text);
		process.exit(1);
	}
	const value = result?.value;
	console.log(typeof value === "string" ? value : JSON.stringify(value, null, "\t") ?? String(value));
} catch (error) {
	console.error(String(error.message ?? error));
	process.exit(1);
}
