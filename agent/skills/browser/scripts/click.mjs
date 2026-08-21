#!/usr/bin/env node
/**
 * Click what a snapshot handle names.
 *
 * Usage: node click.mjs <handle> [--double]
 */
import { callOn, withElement } from "./act.mjs";

const [handle] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const double = process.argv.includes("--double");
if (!handle) {
	console.error("usage: node click.mjs <handle> [--double]");
	process.exit(1);
}

try {
	const said = await withElement(handle, async ({ send, objectId, target }) => {
		// Scroll it into view first: a click at coordinates outside the viewport
		// lands on whatever is there instead.
		await callOn(send, objectId, "function () { this.scrollIntoView({ block: 'center' }); }");
		await new Promise((resolve) => setTimeout(resolve, 120));
		const box = await callOn(send, objectId, `function () {
			const r = this.getBoundingClientRect();
			return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
		}`);
		if (!box || box.w === 0 || box.h === 0) {
			// Zero-sized elements cannot be clicked at coordinates; ask the DOM to
			// do it, which is what a keyboard user's Enter does anyway.
			await callOn(send, objectId, "function () { this.click(); }");
			return `clicked [${handle}] ${target.role} "${target.name}" (via DOM: it has no size on screen)`;
		}
		for (const type of ["mousePressed", "mouseReleased"]) {
			await send("Input.dispatchMouseEvent", {
				type, x: box.x, y: box.y, button: "left", clickCount: double ? 2 : 1,
			});
		}
		return `clicked [${handle}] ${target.role} "${target.name}"`;
	});
	console.log(said);
	console.log("take another snapshot to see what changed");
} catch (error) {
	console.error(String(error.message ?? error));
	process.exit(1);
}
