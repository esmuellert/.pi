#!/usr/bin/env node
/**
 * What is open, and which one commands go to.
 *
 * The number is what --tab takes. Without --tab, a command acts on the tab
 * that is in front, which is marked here.
 *
 * Usage: node tabs.mjs [--close <n>]
 */
import { connect, explain, targetIds } from "./browser.mjs";

const args = process.argv.slice(2);
const closeAt = args.indexOf("--close");

let session;
try {
	session = await connect();
	if (closeAt >= 0) {
		const wanted = String(args[closeAt + 1]);
		const known = await targetIds(session.context, session.pages);
		const victim = /^\d+$/.test(wanted) ? session.pages[Number(wanted)] : session.pages[known.indexOf(wanted)];
		if (!victim) throw new Error(`no tab ${wanted} — run tabs.mjs to see them`);
		const was = victim.url();
		await victim.close();
		console.log(`closed ${was}`);
	}
	const open = session.context.pages();
	const ids = await targetIds(session.context, open);
	for (const [index, page] of open.entries()) {
		const front = page === session.page ? "*" : " ";
		const title = await page.title().catch(() => "");
		console.log(`${front} ${ids[index].slice(0, 12)}  ${title.slice(0, 34).padEnd(34)} ${page.url().slice(0, 58)}`);
	}
	console.log(`${open.length} tab(s); * is where commands go without --tab`);
	console.log("pass one of those ids to --tab; it keeps its meaning when another tab closes");
} catch (error) {
	console.error(explain(error));
	process.exitCode = 1;
} finally {
	await session?.done();
}
