#!/usr/bin/env node
/**
 * Type into what a snapshot handle names.
 *
 * Usage: node fill.mjs <handle> <text> [--append] [--enter]
 */
import { callOn, withElement } from "./act.mjs";

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--"));
const [handle, ...rest] = args.filter((a) => !a.startsWith("--"));
const text = rest.join(" ");
if (!handle || text === undefined) {
	console.error("usage: node fill.mjs <handle> <text> [--append] [--enter]");
	process.exit(1);
}

try {
	const said = await withElement(handle, async ({ send, objectId, target }) => {
		await callOn(send, objectId, "function () { this.scrollIntoView({ block: 'center' }); this.focus(); }");
		if (!flags.includes("--append")) {
			await callOn(send, objectId, `function () {
				if ('value' in this) this.value = '';
				else this.textContent = '';
			}`);
		}
		// Typed as key events rather than assigned, so that what the page
		// listens for -- keydown, input, autocomplete -- actually happens.
		await send("Input.insertText", { text });
		if (flags.includes("--enter")) {
			for (const type of ["keyDown", "keyUp"]) {
				await send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
			}
		}
		const now = await callOn(send, objectId, "function () { return 'value' in this ? this.value : this.textContent; }");
		return `filled [${handle}] ${target.role} "${target.name}" — now: ${JSON.stringify(String(now ?? "").slice(0, 80))}`;
	});
	console.log(said);
} catch (error) {
	console.error(String(error.message ?? error));
	process.exit(1);
}
