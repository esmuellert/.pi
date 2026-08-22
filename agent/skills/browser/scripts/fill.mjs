#!/usr/bin/env node
/**
 * Type into what a snapshot handle names.
 *
 * `fill` sets the value and raises the events a page listens for. `--type`
 * sends real keystrokes instead, one at a time, which is slower but is what an
 * autocomplete that watches keydown needs.
 *
 * Usage: node fill.mjs <handle> <text> [--type] [--append] [--enter]
 */
import { describe, withHandle } from "./act.mjs";
import { explain } from "./browser.mjs";

const args = process.argv.slice(2);
const [handle, ...rest] = args.filter((argument) => !argument.startsWith("--"));
const text = rest.join(" ");
if (!handle || text === undefined) {
	console.error("usage: node fill.mjs <handle> <text> [--type] [--append] [--enter]");
	process.exit(1);
}

try {
	const said = await withHandle(handle, async ({ locator, target }) => {
		if (args.includes("--append")) {
			await locator.focus();
			await locator.pressSequentially(text);
		} else if (args.includes("--type")) {
			await locator.fill("");
			await locator.pressSequentially(text);
		} else {
			await locator.fill(text);
		}
		if (args.includes("--enter")) await locator.press("Enter");
		const now = await locator.inputValue().catch(() => locator.innerText());
		return `filled ${describe(handle, target)} — now: ${JSON.stringify(String(now ?? "").slice(0, 80))}`;
	});
	console.log(said);
} catch (error) {
	console.error(explain(error));
	process.exitCode = 1;
}
