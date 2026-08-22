#!/usr/bin/env node
/**
 * Choose from a <select>.
 *
 * By visible label, which is what the snapshot shows. --value matches the
 * underlying value instead, for the case where two options read the same.
 *
 * Usage: node select.mjs <handle> <label> [--value]
 */
import { describe, withHandle } from "./act.mjs";
import { explain } from "./browser.mjs";

const args = process.argv.slice(2);
const [handle, ...rest] = args.filter((argument) => !argument.startsWith("--"));
const wanted = rest.join(" ");
if (!handle || !wanted) {
	console.error("usage: node select.mjs <handle> <label> [--value]");
	process.exit(1);
}

try {
	console.log(await withHandle(handle, async ({ locator, target }) => {
		const chosen = await locator.selectOption(args.includes("--value") ? { value: wanted } : { label: wanted });
		return `chose ${JSON.stringify(chosen)} in ${describe(handle, target)}`;
	}));
} catch (error) {
	console.error(explain(error));
	process.exitCode = 1;
}
