/**
 * A Chrome DevTools Protocol client, in the standard library.
 *
 * Node 24 ships fetch and WebSocket, and CDP is those two: a JSON endpoint
 * that lists the pages, and a socket per page that takes commands. Nothing
 * here needs installing, which is the whole reason this is written by hand
 * rather than with puppeteer.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export const PORT = Number(process.env.BROWSER_DEBUG_PORT) || 9222;

/**
 * Where the browser keeps its state.
 *
 * A directory of its own, not the one Chrome normally uses. Chrome refuses to
 * open a debugging port on its default profile -- "DevTools remote debugging
 * requires a non-default data directory" -- so sharing your everyday login
 * state is not on offer. This profile is logged into once, by hand, and then
 * kept.
 */
export const PROFILE = process.env.BROWSER_PROFILE ?? join(agentDir(), "browser", "profile");

function agentDir() {
	return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

/**
 * Where snapshots and screenshots go.
 *
 * The system temp directory, because these are readable once and then stale --
 * a snapshot describes a page as it was, and the page has since been clicked.
 * Keeping them beside the profile would mean an ever-growing directory of
 * files nobody will open again.
 */
export function outputDir() {
	const dir = join(tmpdir(), "pi-browser");
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** Where Chrome installs itself, per platform. */
const CHROME_PATHS = {
	darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
	win32: [
		join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
		join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
		join(process.env.LOCALAPPDATA ?? "", "Google\\Chrome\\Application\\chrome.exe"),
	],
	linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"],
};

/** The browser binary, or undefined when none of the usual places has one. */
export function browserBinary() {
	if (process.env.BROWSER_BIN) return process.env.BROWSER_BIN;
	for (const candidate of CHROME_PATHS[process.platform] ?? []) {
		if (candidate && existsSync(candidate)) return candidate;
	}
	return undefined;
}

/** Ask the browser what it is. Undefined when nothing is listening. */
export async function version() {
	try {
		const response = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(2000) });
		return response.ok ? await response.json() : undefined;
	} catch {
		return undefined;
	}
}

/** The pages the browser has open. */
export async function pages() {
	const response = await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(3000) });
	const targets = await response.json();
	return targets.filter((t) => t.type === "page");
}

/**
 * Start the browser if it is not already there.
 *
 * A port already answering is either ours or somebody else's, and there is no
 * way to be sure. Reusing the wrong browser would send clicks into a window
 * that is not this one's, so an unfamiliar occupant is reported rather than
 * adopted -- the caller decides.
 */
export async function ensure({ launch = true } = {}) {
	const running = await version();
	if (running) return { started: false, browser: running.Browser };

	if (!launch) throw new Error(`nothing is listening on ${PORT}`);
	const binary = browserBinary();
	if (!binary) {
		throw new Error("Google Chrome is not installed. Install it from https://google.com/chrome, or set BROWSER_BIN.");
	}
	mkdirSync(PROFILE, { recursive: true });
	const child = spawn(binary, [
		`--remote-debugging-port=${PORT}`,
		`--user-data-dir=${PROFILE}`,
		"--no-first-run",
		"--no-default-browser-check",
		"about:blank",
	], { detached: true, stdio: "ignore" });
	child.unref();

	// The port opens a moment after the process does.
	for (let attempt = 0; attempt < 40; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 250));
		const now = await version();
		if (now) return { started: true, browser: now.Browser };
	}
	throw new Error(`browser started but never opened port ${PORT}`);
}

/** One page's socket, with a promise per command. */
export async function attach(target) {
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", () => reject(new Error("could not attach to the page")), { once: true });
	});
	let nextId = 0;
	const events = [];

	socket.addEventListener("message", (message) => {
		const parsed = JSON.parse(message.data);
		if (parsed.id === undefined) events.push(parsed);
	});

	const send = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = ++nextId;
			const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 30_000);
			const listener = (message) => {
				const parsed = JSON.parse(message.data);
				if (parsed.id !== id) return;
				clearTimeout(timer);
				socket.removeEventListener("message", listener);
				parsed.error ? reject(new Error(`${method}: ${parsed.error.message}`)) : resolve(parsed.result);
			};
			socket.addEventListener("message", listener);
			socket.send(JSON.stringify({ id, method, params }));
		});

	return { send, events, close: () => socket.close() };
}

/** The page a command should act on: the one asked for, or the first open. */
export async function currentPage(targetId) {
	const open = await pages();
	if (open.length === 0) throw new Error("the browser has no pages open");
	if (!targetId) return open[0];
	const found = open.find((p) => p.id === targetId);
	if (!found) throw new Error(`no page with id ${targetId}`);
	return found;
}
