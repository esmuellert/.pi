#!/usr/bin/env node
/**
 * Go to a URL, or move through history.
 *
 * Usage:
 *   node nav.mjs <url> [--new] [--tab <n>]
 *   node nav.mjs --back | --forward [--tab <n>]
 */
import { connect, explain } from "./browser.mjs";

const args = process.argv.slice(2);
const tabAt = args.indexOf("--tab");
const pageIndex = tabAt >= 0 ? Number(args[tabAt + 1]) : undefined;
// A flag is not the url, and neither is the value that follows --tab. Guard on
// tabAt first: without it, index !== -1 + 1 excludes the first argument, which
// is exactly where the url usually is.
const url = args.find((argument, index) => !argument.startsWith("--") && !(tabAt >= 0 && index === tabAt + 1));
const back = args.includes("--back");
const forward = args.includes("--forward");

if (!url && !back && !forward) {
	console.error("usage: node nav.mjs <url> [--new] [--tab <n>]\n       node nav.mjs --back | --forward");
	process.exit(1);
}

let session;
try {
	session = await connect({ pageIndex });
	let page = session.page;
	if (args.includes("--new")) {
		page = await session.context.newPage();
	}

	// goBack returns null both when there is nowhere to go and when the page it
	// arrived at has no HTTP response -- about:blank is one, and it is where the
	// browser starts. So the url is compared instead of trusting the return.
	if (back || forward) {
		const before = page.url();
		if (back) await page.goBack({ waitUntil: "commit" });
		else await page.goForward({ waitUntil: "commit" });
		if (page.url() === before) {
			console.log(`nothing to go ${back ? "back" : "forward"} to`);
			console.log(before);
			process.exit(0);
		}
	} else {
		await page.goto(url.includes("://") ? url : `https://${url}`, { waitUntil: "domcontentloaded" });
	}

	// domcontentloaded is when the markup is there; a single-page app draws
	// after it. Waiting for the network to go quiet catches that, and failing
	// to go quiet is normal on pages that poll, so it is not an error.
	await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

	// Every read is given a deadline of its own. Each of these has hung here at
	// least once after a back or forward, where `commit` returns before the
	// document is finished arriving -- and a navigation that worked should not
	// be reported as nothing at all because printing it did not come back.
	const title = await Promise.race([
		page.evaluate("document.title").catch(() => ""),
		new Promise((resolve) => setTimeout(() => resolve("(no title yet)"), 5000)),
	]);
	console.log(title || "(untitled)");
	console.log(page.url());
	if (args.includes("--new")) {
		console.log(`opened as tab ${session.context.pages().indexOf(page)}`);
	}
} catch (error) {
	console.error(explain(error));
	process.exitCode = 1;
} finally {
	await session?.done();
}
