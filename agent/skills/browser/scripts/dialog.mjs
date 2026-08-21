#!/usr/bin/env node
/**
 * Do something that opens a dialog, and answer it.
 *
 * This cannot be two commands. Once a connection has enabled the Page domain,
 * Chrome treats it as the handler and closes the dialog itself as soon as
 * nobody answers -- on the socket, `javascriptDialogOpening` is followed at
 * once by `javascriptDialogClosed`. So the answer is arranged first, on the
 * same connection, and the trigger sent after.
 *
 * Answering only works because the browser is started with
 * --disable-features=DevToolsDebuggingRestrictions; see cdp.mjs.
 *
 * Usage:
 *   node dialog.mjs --click <handle> [--dismiss] [--text <answer>]
 *   node dialog.mjs --eval '<expression>' [--dismiss] [--text <answer>]
 */
import { currentPage, ensure } from "./cdp.mjs";
import { resolve } from "./act.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
	const at = args.indexOf(name);
	return at >= 0 ? args[at + 1] : undefined;
};
const accept = !args.includes("--dismiss");
const promptText = flag("--text");
const handle = flag("--click");
const expression = flag("--eval");

if (!handle && !expression) {
	console.error("usage: node dialog.mjs (--click <handle> | --eval '<js>') [--dismiss] [--text <answer>]");
	process.exit(1);
}

try {
	await ensure();
	const page = await currentPage();
	const socket = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((ready, failed) => {
		socket.addEventListener("open", ready, { once: true });
		socket.addEventListener("error", () => failed(new Error("could not attach")), { once: true });
	});

	let nextId = 0;
	const replies = new Map();
	const seen = [];

	socket.addEventListener("message", (message) => {
		const parsed = JSON.parse(message.data);
		if (parsed.method === "Page.javascriptDialogOpening") {
			seen.push({ type: parsed.params.type, message: parsed.params.message });
			// Answered here, in the handler. Anything later is too late.
			socket.send(JSON.stringify({
				id: ++nextId,
				method: "Page.handleJavaScriptDialog",
				params: { accept, ...(promptText === undefined ? {} : { promptText }) },
			}));
		}
		if (parsed.method === "Page.javascriptDialogClosed") {
			const last = seen.at(-1);
			if (last) last.answered = parsed.params.result;
		}
		if (parsed.id !== undefined) replies.set(parsed.id, parsed);
	});

	const call = async (method, params = {}) => {
		const id = ++nextId;
		socket.send(JSON.stringify({ id, method, params }));
		for (let waited = 0; waited < 20_000; waited += 100) {
			if (replies.has(id)) return replies.get(id);
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		throw new Error(`${method} timed out`);
	};

	await call("Page.enable");

	// A handle names an element; the page is asked for it by role and name,
	// the same two things the snapshot printed.
	const trigger = expression ?? (() => {
		const target = resolve(handle);
		return `(() => {
			const wanted = ${JSON.stringify(target.name)};
			const match = [...document.querySelectorAll("a, button, input, [role]")]
				.find((el) => (el.innerText || el.value || el.getAttribute("aria-label") || "").trim() === wanted.trim());
			if (!match) throw new Error("[${handle}] is not on the page any more — take a fresh snapshot");
			match.click();
			return "clicked";
		})()`;
	})();

	const outcome = await call("Runtime.evaluate", {
		expression: trigger, returnByValue: true, awaitPromise: true, userGesture: true,
	});
	// A dialog can arrive while the trigger is still running.
	await new Promise((resolve) => setTimeout(resolve, 700));
	socket.close();

	if (outcome.exceptionDetails) {
		console.error(outcome.exceptionDetails.exception?.description?.split("\n")[0] ?? outcome.exceptionDetails.text);
		process.exit(1);
	}
	if (seen.length === 0) {
		console.log("no dialog appeared");
	} else {
		for (const dialog of seen) {
			const got = dialog.answered === undefined ? "" : dialog.answered ? " → accepted" : " → dismissed";
			console.log(`${dialog.type}: ${JSON.stringify(dialog.message)}${got}`);
		}
	}
	if (outcome.result?.value !== undefined) console.log(`result: ${JSON.stringify(outcome.result.value)}`);
} catch (error) {
	console.error(String(error.message ?? error));
	process.exit(1);
}
