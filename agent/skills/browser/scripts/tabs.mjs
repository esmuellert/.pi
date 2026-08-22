#!/usr/bin/env node
/**
 * What is open, and which one commands go to.
 *
 * The number is what --tab takes. Without --tab, a command acts on the tab
 * that is in front, which is marked here.
 *
 * Usage: node tabs.mjs [--close <n>]
 */
import { connect, explain } from "./browser.mjs";

const args = process.argv.slice(2);
const closeAt = args.indexOf("--close");

let session;
try {
	session = await connect();
	if (closeAt >= 0) {
		const victim = session.pages[Number(args[closeAt + 1])];
		if (!victim) throw new Error(`no tab ${args[closeAt + 1]}`);
		const was = victim.url();
		await victim.close();
		console.log(`closed ${was}`);
	}
	const open = session.context.pages();
	for (const [index, page] of open.entries()) {
		const front = page === session.page ? "*" : " ";
		const title = await page.title().catch(() => "");
		console.log(`${front} [${index}] ${title.slice(0, 44).padEnd(44)} ${page.url().slice(0, 70)}`);
	}
	console.log(`${open.length} tab(s); * is where commands go without --tab`);
} catch (error) {
	console.error(explain(error));
	process.exitCode = 1;
} finally {
	await session?.done();
}
