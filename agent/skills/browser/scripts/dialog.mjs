#!/usr/bin/env node
/**
 * Deal with an alert, confirm or prompt that is holding the page.
 *
 * A dialog stops JavaScript, and with it every command that runs JavaScript --
 * eval, click and fill all hang. So does Page.enable and even Runtime.enable
 * on that page's socket, watched directly: those requests get no reply at all,
 * while Page.handleJavaScriptDialog on the same socket answers immediately.
 *
 * Closing the dialog is not enough. Chrome leaves the page's execution context
 * dead afterwards -- Runtime.enable still never returns -- so the page is
 * reloaded, which is the only way found to get it answering again. Anything
 * typed into the page is lost, which is why this says so.
 *
 * Usage: node dialog.mjs [--dismiss] [--text <answer>] [--no-reload]
 *   default is to accept; --text answers a prompt
 */
import { pages, PORT } from "./cdp.mjs";

const args = process.argv.slice(2);
const accept = !args.includes("--dismiss");
const textAt = args.indexOf("--text");
const promptText = textAt >= 0 ? args[textAt + 1] : undefined;

/**
 * Talk to a page without waiting for any reply first.
 *
 * The usual client awaits each command, which is exactly what a dialog
 * prevents. Here the command is sent and the socket closed shortly after:
 * handleJavaScriptDialog is acted on whether or not anyone waits for it.
 */
async function tell(target, method, params) {
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", () => reject(new Error("could not attach")), { once: true });
	});
	socket.send(JSON.stringify({ id: 1, method, params }));
	await new Promise((resolve) => setTimeout(resolve, 400));
	socket.close();
}

try {
	const open = await pages();
	if (open.length === 0) throw new Error("no pages open");
	let handled = 0;
	for (const page of open) {
		try {
			// No Page.enable first. It is the obvious thing to try and it never
			// returns while a dialog is up -- watching the socket, id 1 got no
			// reply and id 2 did. handleJavaScriptDialog works without it.
			await tell(page, "Page.handleJavaScriptDialog", {
				accept,
				...(promptText === undefined ? {} : { promptText }),
			});
			handled += 1;
		} catch {
			// A page with no dialog rejects the command; that is not a failure.
		}
	}
	console.log(`${accept ? "accepted" : "dismissed"} dialogs on ${handled} page(s)`);

	if (args.includes("--no-reload")) {
		console.log("not reloading; the page's execution context is probably still dead");
		process.exit(0);
	}
	// Reload without waiting for a reply, for the same reason as above.
	for (const page of open) await tell(page, "Page.reload", {});
	await new Promise((resolve) => setTimeout(resolve, 2500));
	console.log("reloaded — anything typed into the page before the dialog is gone");
	console.log("take a fresh snapshot; the old handles are stale");
} catch (error) {
	console.error(String(error.message ?? error));
	process.exit(1);
}
