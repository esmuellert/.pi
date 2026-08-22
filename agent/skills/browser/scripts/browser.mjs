/**
 * Starting the browser, and connecting to it.
 *
 * The browser is started by us and outlives every command: each script here is
 * its own short-lived process, and they all attach to the same window. That is
 * why Playwright's own `chromium.launch()` is not used -- it owns the browser
 * for the lifetime of the process that called it. We open the debugging port
 * ourselves and Playwright connects over it.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PORT = Number(process.env.BROWSER_DEBUG_PORT) || 9222;

/**
 * Where the browser keeps its state.
 *
 * A directory of its own, not the one Chrome normally uses. Chrome refuses to
 * open a debugging port on its default profile -- "DevTools remote debugging
 * requires a non-default data directory" -- so sharing your everyday login
 * state is not on offer. This profile is logged into once, by hand, and kept.
 */
export const PROFILE = process.env.BROWSER_PROFILE ?? join(agentDir(), "browser", "profile");

function agentDir() {
	return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

/**
 * A name for a file that will not collide with the one written a moment ago.
 *
 * Seconds are not enough: two snapshots taken in the same second wrote the same
 * name and one was lost.
 */
export function stamp() {
	return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 23);
}

/**
 * Where snapshots and screenshots go.
 *
 * The system temp directory, because these are readable once and then stale --
 * a snapshot describes a page as it was, and the page has since been clicked.
 *
 * Per session, because two agents sharing one browser otherwise share one
 * uids.json: the second snapshot overwrites the first, and the first agent's
 * next click lands on an element it never saw, reported as though it were the
 * one it asked for. Verified by doing it -- a fill aimed at a combobox on one
 * tab went into a textbox on another.
 *
 * pi sets PI_SESSION_ID, so this costs the caller nothing. Without it -- run
 * by hand, or by something else -- the shared directory is used, which is the
 * old behaviour and fine for one user at a time.
 */
export function outputDir() {
	const session = process.env.PI_SESSION_ID;
	const dir = join(tmpdir(), "pi-browser", session ? session.slice(0, 8) : "shared");
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

/**
 * Load Playwright, installing it on first use.
 *
 * A skill is not part of the workspace and nothing installs it in advance --
 * deliberately. It is used occasionally, weighs 13MB, and a machine that never
 * opens a browser should never carry it. So the agent that reaches for it is
 * the one that pays, once, and every machine after that is the same machine
 * whether or not it was set up first.
 *
 * This is why `setup.mjs bootstrap` does not install skills, and why the tests
 * import nothing from here that needs the package: `playwright-core` is loaded
 * dynamically, so `pnpm verify` checks this code on a machine that has never
 * installed it.
 */
export async function playwright() {
	try {
		return await import("playwright-core");
	} catch (error) {
		if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
	}

	const skill = dirname(dirname(fileURLToPath(import.meta.url)));
	console.error("installing playwright-core (first run, about 13MB)...");
	const installed = await install(skill);
	if (!installed) {
		throw new Error(
			`playwright-core is not installed and installing it failed. Run:\n  cd ${skill} && npm install`,
		);
	}
	try {
		return await import("playwright-core");
	} catch {
		throw new Error(`installed playwright-core into ${skill} but it still cannot be loaded`);
	}
}

/**
 * Run an install in the skill's own directory.
 *
 * pnpm if it is there, npm otherwise: npm ships with node, so this works on a
 * machine that has nothing else. Both are given the same directory explicitly
 * rather than relying on the current one, which belongs to whoever ran the
 * command.
 */
async function install(dir) {
	for (const [command, args] of [["pnpm", ["install"]], ["npm", ["install", "--no-audit", "--no-fund"]]]) {
		const finished = await new Promise((resolve) => {
			const child = spawn(command, args, { cwd: dir, stdio: "ignore", shell: process.platform === "win32" });
			child.on("error", () => resolve(false));
			child.on("exit", (code) => resolve(code === 0));
		});
		if (finished) return true;
	}
	return false;
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

/**
 * How long to wait for the port after starting Chrome.
 *
 * A cold start on a slow disk is seconds; there is no signal to wait on, since
 * the process exists before the port does.
 */
const PORT_WAIT_MS = 10_000;
const PORT_POLL_MS = 250;

/** Start the browser if it is not already there. */
export async function ensure({ launch = true } = {}) {
	const running = await version();
	if (running) return { started: false, browser: running.Browser };

	if (!launch) throw new Error(`nothing is listening on port ${PORT}`);
	const binary = browserBinary();
	if (!binary) {
		throw new Error("Google Chrome is not installed. Install it from https://google.com/chrome, or set BROWSER_BIN.");
	}
	// Whether anyone has logged into this profile yet, asked before Chrome
	// creates the directory. `started` only means we launched the browser, which
	// happens every time it was closed.
	const fresh = !existsSync(join(PROFILE, "Default"));
	mkdirSync(PROFILE, { recursive: true });
	const child = spawn(binary, [
		`--remote-debugging-port=${PORT}`,
		`--user-data-dir=${PROFILE}`,
		"--no-first-run",
		"--no-default-browser-check",
		// Without this, Chrome accepts Input.dispatchMouseEvent, Input.dispatchKeyEvent
		// and Page.handleJavaScriptDialog over a debugging *port* and silently does
		// nothing: the command returns success, no event reaches the page, and a
		// dialog closes as Cancel one millisecond after being answered with accept.
		// Playwright's own launch avoids this by using --remote-debugging-pipe; a
		// port is what lets separate processes share one browser, which is the
		// whole shape of this skill, so the restriction is turned off instead.
		"--disable-features=DevToolsDebuggingRestrictions",
		"about:blank",
	], { detached: true, stdio: "ignore" });
	child.unref();

	for (let waited = 0; waited < PORT_WAIT_MS; waited += PORT_POLL_MS) {
		await new Promise((resolve) => setTimeout(resolve, PORT_POLL_MS));
		const now = await version();
		if (now) return { started: true, fresh, browser: now.Browser };
	}
	throw new Error(`Chrome started but never opened port ${PORT}`);
}

/**
 * Connect, and hand back the page to act on.
 *
 * `pageIndex` names a tab as `tabs.mjs` numbers them. Without one this is the
 * tab that was most recently brought to the front, which is what "the page"
 * means to someone looking at the window.
 */
/**
 * How long an action waits for an element to become usable.
 *
 * Playwright's own default is 30 seconds, which is right for a test suite that
 * runs unattended and wrong here: a person is reading the output, and an
 * element that is not ready in ten seconds is usually not going to be. Long
 * waits are asked for explicitly, by wait.mjs.
 */
export const ACTION_TIMEOUT_MS = Number(process.env.BROWSER_TIMEOUT_MS) || 10_000;

export async function connect({ pageIndex } = {}) {
	const { chromium } = await playwright();
	await ensure();
	const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
	const context = browser.contexts()[0];
	if (!context) {
		await browser.close();
		throw new Error("the browser has no context");
	}
	const open = context.pages();
	if (open.length === 0) {
		await browser.close();
		throw new Error("the browser has no pages open — run nav.mjs <url>");
	}
	for (const candidate of open) candidate.setDefaultTimeout(ACTION_TIMEOUT_MS);
	const page = pageIndex === undefined ? await frontmost(open) : open[Number(pageIndex)];
	if (!page) {
		await browser.close();
		throw new Error(`no tab ${pageIndex} — there are ${open.length}; run tabs.mjs to see them`);
	}
	return { browser, context, page, pages: open, done: () => browser.close() };
}

/**
 * The tab a person would say they are looking at.
 *
 * Playwright's page order follows the order tabs were created, which is not
 * the order they were used. `document.visibilityState` is "visible" only for
 * the tab in front, so the browser is asked rather than guessed at. Several
 * windows can each have a visible tab; the last one wins, which matches
 * "whatever was touched most recently" closely enough to be predictable.
 */
async function frontmost(open) {
	let candidate = open[0];
	for (const page of open) {
		try {
			if (await page.evaluate("document.visibilityState") === "visible") candidate = page;
		} catch {
			// A tab that is still loading or has crashed cannot answer; skip it.
		}
	}
	return candidate;
}

/**
 * Turn a string into something `page.evaluate` will run.
 *
 * Playwright evaluates a string as an expression, not as a function source: it
 * is given "() => 1+1" it returns undefined, since that is what evaluating a
 * function literal yields. A body containing statements has to be wrapped in a
 * call; a bare expression must be left exactly as it is.
 */
export function runnable(expression) {
	return /\breturn\b|;/.test(expression) ? `(async () => { ${expression} })()` : expression;
}

/**
 * What to print when an action fails.
 *
 * Playwright appends a call log -- every retry of every actionability check --
 * which is dozens of lines and repeats the same thing. The first line says
 * what was being waited for; the rest is for a test report, not a reader.
 */
export function explain(error) {
	// Playwright colours the call log, and the escapes outlive the text when
	// only part of it is kept.
	const message = String(error?.message ?? error).replace(/\u001B\[[0-9;]*m/g, "");
	const [first] = message.split("\nCall log:");
	if (/Timeout .* exceeded/.test(first)) {
		const waiting = message.match(/- waiting for ([^\n]+)/)?.[1];
		const checks = [...message.matchAll(/- (element is not [^\n]+|waiting for element to be [^\n]+)/g)]
			.map((match) => match[1]);
		const last = checks.at(-1);
		return [first.trim(), waiting && `  it was: ${waiting}`, last && `  last check: ${last}`]
			.filter(Boolean).join("\n");
	}
	return first.trim();
}
