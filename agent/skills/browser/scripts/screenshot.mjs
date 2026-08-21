#!/usr/bin/env node
/**
 * A picture of the page, for when the shape matters and the text does not say
 * it. Prefer snapshot.mjs: it is text, and costs a fraction of the tokens.
 *
 * Usage: node screenshot.mjs [--full] [--target <id>]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { attach, currentPage, ensure, outputDir } from "./cdp.mjs";

const args = process.argv.slice(2);
const targetAt = args.indexOf("--target");
const targetId = targetAt >= 0 ? args[targetAt + 1] : undefined;

try {
	await ensure();
	const page = await currentPage(targetId);
	const { send, close } = await attach(page);
	const { data } = await send("Page.captureScreenshot", {
		format: "png",
		captureBeyondViewport: args.includes("--full"),
	});
	close();
	const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	const file = join(outputDir(), `shot-${stamp}.png`);
	writeFileSync(file, Buffer.from(data, "base64"));
	console.log(file);
	console.log(`${(Buffer.from(data, "base64").length / 1024).toFixed(0)}KB — open it with the read tool`);
} catch (error) {
	console.error(String(error.message ?? error));
	process.exit(1);
}
