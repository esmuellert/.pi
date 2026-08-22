#!/usr/bin/env node
/**
 * Start the browser, or report the one already running.
 *
 * The window stays open when a command finishes: it is meant to be used by
 * hand as well, and closing it would throw away the login state.
 *
 * Usage: node start.mjs [--status]
 */
import { PORT, PROFILE, ensure, playwright, version } from "./browser.mjs";

try {
	// Fail here, with an instruction, rather than in whichever script runs next.
	await playwright();

	if (process.argv.includes("--status")) {
		const running = await version();
		console.log(running ? `${running.Browser} on port ${PORT}` : `nothing is listening on port ${PORT}`);
		process.exit(running ? 0 : 1);
	}

	const { started, fresh, browser } = await ensure();
	console.log(`${started ? "started" : "already running"}: ${browser}`);
	console.log(`profile: ${PROFILE}`);
	console.log(`port: ${PORT}`);
	if (fresh) console.log("\nThis profile is new. Log into anything it needs, once, in that window; it is kept.");
} catch (error) {
	console.error(String(error.message ?? error));
	process.exit(1);
}
