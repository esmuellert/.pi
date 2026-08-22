#!/usr/bin/env node
/**
 * Hover, for menus and tooltips that only appear under the pointer.
 *
 * Usage: node hover.mjs <handle>
 */
import { describe, withHandle } from "./act.mjs";
import { explain } from "./browser.mjs";

const [handle] = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
if (!handle) {
	console.error("usage: node hover.mjs <handle>");
	process.exit(1);
}

try {
	console.log(await withHandle(handle, async ({ locator, target }) => {
		await locator.hover();
		return `hovering ${describe(handle, target)}`;
	}));
	console.log("take another snapshot to see what appeared");
} catch (error) {
	console.error(explain(error));
	process.exitCode = 1;
}
