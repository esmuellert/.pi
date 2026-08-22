#!/usr/bin/env node
/**
 * Do something that opens a dialog, and answer it.
 *
 * This cannot be two commands: an unanswered dialog is closed by Chrome
 * itself, so the answer has to be arranged before the thing that opens it.
 * The handler below is registered first, and the click or expression follows.
 *
 * Answering only works because the browser is started with
 * --disable-features=DevToolsDebuggingRestrictions; see browser.mjs.
 *
 * Usage:
 *   node dialog.mjs --click <handle> [--dismiss] [--text <answer>]
 *   node dialog.mjs --eval '<expression>' [--dismiss] [--text <answer>]
 */
import { UID_ATTRIBUTE, lookup } from "./act.mjs";
import { connect, explain, runnable } from "./browser.mjs";

const args = process.argv.slice(2);
const at = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const accept = !args.includes("--dismiss");
const answer = at("--text");
const handle = at("--click");
const expression = at("--eval");

if (!handle && !expression) {
	console.error("usage: node dialog.mjs (--click <handle> | --eval '<js>') [--dismiss] [--text <answer>]");
	process.exit(1);
}

let session;
try {
	session = await connect({ tab: handle ? lookup(handle).tab : undefined });
	const seen = [];
	session.page.on("dialog", async (dialog) => {
		seen.push({ type: dialog.type(), message: dialog.message() });
		if (accept) await dialog.accept(answer);
		else await dialog.dismiss();
	});

	if (handle) {
		const selector = `[${UID_ATTRIBUTE}="${lookup(handle).uid}"]`;
		// `.find` with an async predicate matches the first frame every time: an
		// async function returns a promise, and a promise is truthy. So each frame
		// is asked in turn.
		let locator;
		for (const frame of session.page.frames()) {
			const candidate = frame.locator(selector);
			if (await candidate.count().catch(() => 0) > 0) {
				locator = candidate;
				break;
			}
		}
		if (!locator) throw new Error(`[${handle}] is no longer on the page — take another snapshot`);
		// Marked so a click that reports success but arrives nowhere can be told
		// apart from a click that simply opens no dialog.
		await locator.evaluate((element) => {
			element.addEventListener("click", () => { element.__piClicked = true; }, { once: true, capture: true });
		}).catch(() => {});
		// A click that opens a dialog does not return until the dialog has been
		// answered, so it is left running while the handler above answers it.
		// Awaiting it here first would deadlock.
		const clicking = locator.click({ noWaitAfter: true });
		await Promise.race([
			clicking,
			session.page.waitForEvent("dialog", { timeout: 5000 }).catch(() => {}),
		]);
		await clicking.catch(() => {});
	} else {
		await session.page.evaluate(runnable(expression));
	}

	await session.page.waitForTimeout(600);
	if (seen.length === 0) {
		// Distinguish "that click opens no dialog" from Chrome having stopped
		// delivering input, which looks identical from here and is the more
		// likely of the two when it has been running a while.
		const landed = handle
			? await session.page.evaluate(
				`document.querySelector('[${UID_ATTRIBUTE}="${lookup(handle).uid}"]')?.__piClicked === true`,
			).catch(() => true)
			: true;
		console.log(landed
			? "no dialog appeared"
			: "the click was accepted but the page did not receive it.\n"
				+ "  This is Chrome, not the page: restart the browser and try again.\n"
				+ "    pkill -f remote-debugging-port && node start.mjs");
	}
	for (const dialog of seen) {
		console.log(`${dialog.type}: ${JSON.stringify(dialog.message)} → ${accept ? "accepted" : "dismissed"}`);
	}
} catch (error) {
	console.error(explain(error));
	process.exitCode = 1;
} finally {
	await session?.done();
}
