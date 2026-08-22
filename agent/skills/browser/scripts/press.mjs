#!/usr/bin/env node
/**
 * Send keys.
 *
 * With a handle the keys go to that element; without one they go wherever the
 * focus is, which is what Tab and Escape usually want.
 *
 * Key names are Playwright's: Enter, Tab, Escape, ArrowDown, PageDown, and
 * combinations like "Control+A" or "Shift+Tab".
 *
 * Usage:
 *   node press.mjs <key> [--handle <n>] [--times <n>]
 */
import { describe, withHandle } from "./act.mjs";
import { connect, explain } from "./browser.mjs";

const args = process.argv.slice(2);
const at = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const [key] = args.filter((argument, index) => !argument.startsWith("--")
	&& args[index - 1] !== "--handle" && args[index - 1] !== "--times");
const handle = at("--handle");
const times = Number(at("--times") ?? 1);

if (!key) {
	console.error("usage: node press.mjs <key> [--handle <n>] [--times <n>]");
	process.exit(1);
}

try {
	if (handle) {
		console.log(await withHandle(handle, async ({ locator, target }) => {
			for (let n = 0; n < times; n += 1) await locator.press(key);
			return `pressed ${key}${times > 1 ? ` ×${times}` : ""} on ${describe(handle, target)}`;
		}));
	} else {
		const session = await connect();
		try {
			for (let n = 0; n < times; n += 1) await session.page.keyboard.press(key);
			console.log(`pressed ${key}${times > 1 ? ` ×${times}` : ""} on whatever has focus`);
		} finally {
			await session.done();
		}
	}
} catch (error) {
	console.error(explain(error));
	process.exitCode = 1;
}
