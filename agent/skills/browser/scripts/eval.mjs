#!/usr/bin/env node
/**
 * Run JavaScript in the page. The way to do anything the other scripts do not.
 *
 * It runs as a function body, so `const top = ...` is fine here even though
 * `top` is one of window's own properties -- which is not true at a page's
 * real top level, where declaring one is a SyntaxError.
 *
 * A page can hold an editor Chrome does not expose as interactive -- TinyMCE's
 * body is a `generic` with no properties, so the snapshot gives it no handle.
 * --frame runs inside one of the frames snapshot.mjs listed, which is the way
 * into anything like that.
 *
 * Usage: node eval.mjs '<expression>' [--tab <n>] [--frame <n>]
 */
import { connect, explain, runnable } from "./browser.mjs";

const args = process.argv.slice(2);
const tabAt = args.indexOf("--tab");
const pageIndex = tabAt >= 0 ? Number(args[tabAt + 1]) : undefined;
const frameAt = args.indexOf("--frame");
const frameIndex = frameAt >= 0 ? Number(args[frameAt + 1]) : undefined;
const expression = args.find((argument, index) => !argument.startsWith("--")
	&& !(tabAt >= 0 && index === tabAt + 1) && !(frameAt >= 0 && index === frameAt + 1));

if (!expression) {
	console.error("usage: node eval.mjs '<expression>' [--tab <n>] [--frame <n>]");
	process.exit(1);
}

const session = await connect({ pageIndex });
try {
	const frames = session.page.frames();
	if (frameIndex !== undefined && !frames[frameIndex]) {
		throw new Error(`no frame ${frameIndex} — the page has ${frames.length}: ${frames.map((f, n) => `${n}=${f.url()}`).join(", ")}`);
	}
	const where = frameIndex === undefined ? session.page : frames[frameIndex];
	const value = await where.evaluate(runnable(expression));
	console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
} catch (error) {
	console.error(explain(error));
	process.exitCode = 1;
} finally {
	await session.done();
}
