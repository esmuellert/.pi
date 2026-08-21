#!/usr/bin/env node
/**
 * Go to a URL, and wait for the page to settle.
 *
 * Usage: node nav.mjs <url> [--new] [--target <id>]
 */
import { attach, currentPage, ensure, pages } from "./cdp.mjs";

const args = process.argv.slice(2);
const targetAt = args.indexOf("--target");
const targetId = targetAt >= 0 ? args[targetAt + 1] : undefined;
// A flag is not the url, and neither is the value that follows --target.
const url = args.find((a, i) => !a.startsWith("--") && !(targetAt >= 0 && i === targetAt + 1));
if (!url) {
	console.error("usage: node nav.mjs <url> [--new]");
	process.exit(1);
}

try {
	await ensure();
	if (args.includes("--new")) {
		await fetch(`http://127.0.0.1:${process.env.BROWSER_DEBUG_PORT || 9222}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
		await new Promise((resolve) => setTimeout(resolve, 1500));
		const open = await pages();
		const made = open.at(-1);
		console.log(`${made.id}  ${made.title || "(loading)"}  ${made.url}`);
		process.exit(0);
	}

	const page = await currentPage(targetId);
	const { send, close } = await attach(page);
	await send("Page.enable");
	await send("Page.navigate", { url: url.includes("://") ? url : `https://${url}` });
	// Settling is not the load event: single-page apps finish rendering after
	// it. A short wait afterwards costs less than a snapshot of a half-drawn page.
	await new Promise((resolve) => setTimeout(resolve, 2500));
	const title = await send("Runtime.evaluate", { expression: "document.title", returnByValue: true });
	const here = await send("Runtime.evaluate", { expression: "location.href", returnByValue: true });
	close();
	console.log(`${title.result.value}`);
	console.log(`${here.result.value}`);
} catch (error) {
	console.error(String(error.message ?? error));
	process.exit(1);
}
