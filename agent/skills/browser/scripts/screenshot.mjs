#!/usr/bin/env node
/**
 * A picture of the page, for when the shape matters and words do not describe
 * it: layout, whether an image rendered, what a chart shows.
 *
 * Usage: node screenshot.mjs [--full] [--handle <n>] [--tab <n>]
 */
import { statSync } from "node:fs";
import { join } from "node:path";

import { withHandle } from "./act.mjs";
import { connect, explain, outputDir, stamp } from "./browser.mjs";

const args = process.argv.slice(2);
const at = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const handle = at("--handle");
const tab = at("--tab");
const file = join(outputDir(), `shot-${stamp()}.png`);

try {
	if (handle) {
		await withHandle(handle, async ({ locator }) => locator.screenshot({ path: file }));
	} else {
		const session = await connect({ tab });
		try {
			await session.page.screenshot({ path: file, fullPage: args.includes("--full") });
		} finally {
			await session.done();
		}
	}
	console.log(file);
	console.log(`${(statSync(file).size / 1024).toFixed(0)}KB — open it with the read tool`);
} catch (error) {
	console.error(explain(error));
	process.exitCode = 1;
}
