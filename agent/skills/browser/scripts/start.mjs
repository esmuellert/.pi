#!/usr/bin/env node
/**
 * Start the browser, or report the one already running.
 *
 * Usage: node start.mjs [--status]
 *   --status   say what is there without starting anything
 */
import { ensure, pages, PORT, PROFILE, version } from "./cdp.mjs";

const status = process.argv.includes("--status");

try {
	if (status) {
		const running = await version();
		if (!running) {
			console.log(`nothing on port ${PORT}`);
			process.exit(0);
		}
		console.log(`${running.Browser} on port ${PORT}`);
		for (const page of await pages()) console.log(`  ${page.id}  ${page.title || "(untitled)"}  ${page.url}`);
		process.exit(0);
	}

	const { started, browser } = await ensure();
	console.log(`${started ? "started" : "already running"}: ${browser}`);
	console.log(`profile: ${PROFILE}`);
	const open = await pages();
	for (const page of open) console.log(`  ${page.id}  ${page.title || "(untitled)"}  ${page.url}`);
	if (started) console.log("\nThis profile is new. Log into anything it needs, once; it is kept.");
} catch (error) {
	console.error(String(error.message ?? error));
	process.exit(1);
}
