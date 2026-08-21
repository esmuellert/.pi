#!/usr/bin/env node
/**
 * Click what a snapshot handle names.
 *
 * Real mouse events first, because a page can tell the difference: an
 * `isTrusted` click is the only kind some listeners act on, and coordinates
 * are what a person's click actually is.
 *
 * But `Input.dispatchMouseEvent` returns success and delivers nothing on this
 * machine -- watched with capture-phase listeners, zero events arrive, while
 * `Input.insertText` and `Runtime.evaluate` on the same socket work. The window
 * is visible, focused and hit-testable at those coordinates, so there is no
 * state to correct. Rather than guess at why, this checks whether the click
 * landed and falls back to dispatching the events from inside the page, which
 * does work.
 *
 * The fallback is second, not first: it produces untrusted events, and a page
 * that refuses those would fail silently if it were tried first.
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
		// A marker to tell whether anything reached the page.
		await callOn(send, objectId, `function () {
			this.__clicked = false;
			this.addEventListener("click", () => { this.__clicked = true; }, { once: true, capture: true });
		}`);

		await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
		for (const type of ["mousePressed", "mouseReleased"]) {
			await send("Input.dispatchMouseEvent", {
				type, x: box.x, y: box.y, button: "left", buttons: type === "mousePressed" ? 1 : 0,
				clickCount: double ? 2 : 1,
			});
		}
		await new Promise((resolve) => setTimeout(resolve, 250));

		const landed = await callOn(send, objectId, "function () { return this.__clicked === true; }").catch(() => true);
		if (landed) return `clicked [${handle}] ${target.role} "${target.name}"`;

		// Nothing arrived. Dispatch from inside the page instead.
		await callOn(send, objectId, `function (double) {
			const r = this.getBoundingClientRect();
			const at = { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
			for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
				const Event = type.startsWith("pointer") ? PointerEvent : MouseEvent;
				this.dispatchEvent(new Event(type, { ...at, detail: double ? 2 : 1 }));
			}
		}`, [double]);
		return `clicked [${handle}] ${target.role} "${target.name}" (synthetic: real mouse events did not reach the page)`;
	});
	console.log(said);
	console.log("take another snapshot to see what changed");
} catch (error) {
	console.error(String(error.message ?? error));
	process.exit(1);
}
