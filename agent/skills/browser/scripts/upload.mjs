#!/usr/bin/env node
/**
 * Put a file into a file input.
 *
 * This is the one thing eval cannot do: a page's own JavaScript is forbidden
 * from setting `input.files`, so without the browser's cooperation there is no
 * way to attach a file at all.
 *
 * Usage: node upload.mjs <handle> <path> [<path>...]
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, withHandle } from "./act.mjs";
import { explain } from "./browser.mjs";

const args = process.argv.slice(2);
const [handle, ...paths] = args.filter((argument) => !argument.startsWith("--"));
if (!handle || paths.length === 0) {
	console.error("usage: node upload.mjs <handle> <path> [<path>...]");
	process.exit(1);
}
const files = paths.map((path) => resolve(path));
const missing = files.filter((file) => !existsSync(file));
if (missing.length) {
	console.error(`no such file: ${missing.join(", ")}`);
	process.exit(1);
}

try {
	console.log(await withHandle(handle, async ({ locator, target }) => {
		await locator.setInputFiles(files);
		return `attached ${files.length} file(s) to ${describe(handle, target)}`;
	}));
} catch (error) {
	console.error(explain(error));
	process.exitCode = 1;
}
