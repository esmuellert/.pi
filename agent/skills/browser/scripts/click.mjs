#!/usr/bin/env node
/**
 * Click what a snapshot handle names.
 *
 * Playwright waits for the element to be attached, visible, to have stopped
 * moving, to be enabled, and for a click at that point to actually reach it --
 * retrying until it does. That last check is why a cookie banner over a button
 * now fails loudly instead of being clicked in its place.
 *
 * Usage: node click.mjs <handle> [--double] [--right] [--force]
 */
import { describe, withHandle } from "./act.mjs";
import { explain } from "./browser.mjs";

const args = process.argv.slice(2);
const [handle] = args.filter((argument) => !argument.startsWith("--"));
if (!handle) {
	console.error("usage: node click.mjs <handle> [--double] [--right] [--force]");
	process.exit(1);
}

try {
	const said = await withHandle(handle, async ({ locator, target }) => {
		const options = {
			// --force skips the checks above. It is for the case where something
			// invisible overlaps the element and the click would still work.
			force: args.includes("--force"),
			button: args.includes("--right") ? "right" : "left",
		};

		// Chrome stops delivering synthetic input after the browser has been up a
		// while: the click is accepted, the page receives nothing, and every check
		// above still passes. It is not this code -- raw CDP behaves the same way,
		// with the debugging restrictions already turned off -- and restarting the
		// browser is what brings it back. Reporting a click that did nothing is the
		// worst outcome, so it is checked.
		await locator.evaluate((element) => {
			element.addEventListener("click", () => { element.__piClicked = true; }, { once: true, capture: true });
		}).catch(() => {});

		if (args.includes("--double")) await locator.dblclick(options);
		else await locator.click(options);

		// A click that navigates takes the element with it; that is a click that
		// plainly landed, so a missing element here is not a failure.
		const landed = await locator.evaluate((element) => element.__piClicked === true).catch(() => true);
		if (!landed) {
			throw new Error(
				`the click was accepted but the page did not receive it.\n`
				+ `  This is Chrome, not the page: restart the browser and try again.\n`
				+ `    pkill -f remote-debugging-port && node start.mjs`,
			);
		}
		return `clicked ${describe(handle, target)}`;
	});
	console.log(said);
	console.log("take another snapshot to see what changed");
} catch (error) {
	console.error(explain(error));
	process.exitCode = 1;
}
