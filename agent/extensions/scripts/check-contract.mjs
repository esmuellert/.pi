#!/usr/bin/env node
/**
 * Contract check for the extensions in this repo.
 *
 * The unit tests cover our own logic against stubs, so they would keep passing
 * if pi changed the APIs underneath. This script checks the other half: that
 * every pi export, method and theme key we depend on still exists and still
 * behaves the way the extensions assume.
 *
 * Run after `pi update`:
 *     cd ~/.pi/agent/extensions && pnpm contract
 *
 * Exits non-zero on the first broken contract, so it can gate an upgrade.
 */

import { execFileSync } from "node:child_process";
import { accessSync, constants as fsConstants, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const results = [];
let failed = 0;

function check(name, fn) {
	try {
		const detail = fn();
		results.push(["ok", name, detail ?? ""]);
	} catch (err) {
		failed++;
		results.push(["FAIL", name, err instanceof Error ? err.message : String(err)]);
	}
}

const assert = (cond, msg) => {
	if (!cond) throw new Error(msg);
};

/** The launcher shim execs an absolute path to dist/cli.js; that is the pointer back to the package. */
const SHIM_PATTERN = String.raw`"?([^"\s]*node_modules/@earendil-works/pi-coding-agent)/dist/cli\.js"?`;

/**
 * Locate the installed pi by walking PATH, skipping anything inside this
 * workspace: pnpm puts node_modules/.bin first, so a local copy would shadow
 * the real one. Done without a shell so it does not depend on `command -v -a`,
 * which is a bash extension rather than POSIX.
 */
function findPiShim(workspace) {
	for (const dir of (process.env.PATH ?? "").split(":")) {
		if (!dir) continue;
		const candidate = join(dir, "pi");
		if (resolve(candidate).startsWith(workspace)) continue;
		try {
			accessSync(candidate, fsConstants.X_OK);
			return candidate;
		} catch {
			// Not here; keep walking.
		}
	}
	return undefined;
}

function findPiRoot() {
	const workspace = resolve(dirname(dirname(fileURLToPath(import.meta.url))));
	const shim = findPiShim(workspace);
	assert(shim, "no pi on PATH outside this workspace");
	const match = new RegExp(SHIM_PATTERN).exec(readFileSync(shim, "utf-8"));
	assert(match, `could not find the package path inside ${shim}`);
	const root = match[1].replace(/\$basedir/g, dirname(shim));
	assert(existsSync(join(root, "package.json")), `resolved ${root} but it has no package.json`);
	// Global installs are symlinks into a store; siblings such as pi-tui only
	// resolve from the real path.
	return realpathSync(resolve(root));
}

// ---------------------------------------------------------------- resolution

let piPath;
let piDist;
let tuiDist;

check("pi package resolves", () => {
	piPath = findPiRoot();
	piDist = join(piPath, "dist", "index.js");
	assert(existsSync(piDist), `missing ${piDist}`);
	return JSON.parse(readFileSync(join(piPath, "package.json"), "utf-8")).version;
});

check("pi-tui package resolves", () => {
	// Resolve the way pi itself does: from pi's own location, not from here.
	const requireFromPi = createRequire(join(piPath, "package.json"));
	const root = dirname(requireFromPi.resolve("@earendil-works/pi-tui/package.json"));
	const dist = join(root, "dist", "utils.js");
	assert(existsSync(dist), `missing ${dist}`);
	tuiDist = dist;
	return JSON.parse(readFileSync(join(root, "package.json"), "utf-8")).version;
});

// Loaded only when the resolution checks above succeeded, so a missing package
// reports as one failed contract rather than crashing the whole run.
const pi = piDist && existsSync(piDist) ? await import(piDist) : {};
const tui = tuiDist && existsSync(tuiDist) ? await import(tuiDist) : {};

// scripts/ lives inside the workspace; packages are its siblings.
const extRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// -------------------------------------------------------------- cd extension

check("cd: SessionManager is exported", () => {
	assert(typeof pi.SessionManager?.create === "function", "SessionManager.create missing");
});

check("cd: CURRENT_SESSION_VERSION is exported", () => {
	assert(typeof pi.CURRENT_SESSION_VERSION === "number", "not a number");
	return `v${pi.CURRENT_SESSION_VERSION}`;
});

check("cd: SessionManager.create(cwd) assigns a slot without writing", () => {
	const agent = mkdtempSync(join(tmpdir(), "pi-contract-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	try {
		process.env.PI_CODING_AGENT_DIR = agent;
		const work = join(agent, "work");
		const sm = pi.SessionManager.create(work, undefined, { parentSession: "/parent.jsonl" });
		const file = sm.getSessionFile();
		assert(typeof file === "string" && file.endsWith(".jsonl"), `bad session file: ${file}`);
		assert(sm.getCwd() === work, `cwd ${sm.getCwd()} !== ${work}`);
		assert(typeof sm.getSessionId() === "string" && sm.getSessionId().length > 0, "no session id");
		// /cd relies on the file not existing yet: it writes the copy itself.
		assert(!existsSync(file), "create() wrote a file; /cd would clobber it");
		// The encoded directory is what /cd depends on pi to compute.
		assert(file.includes(`${join("sessions", "--")}`), `unexpected session dir layout: ${file}`);
	} finally {
		// Restoring matters: assigning undefined would set the string "undefined"
		// and every child process below would look for credentials in ./undefined.
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(agent, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------- footer extension

check("footer: pi-tui exports the measuring helpers", () => {
	assert(typeof tui.visibleWidth === "function", "visibleWidth missing");
	assert(typeof tui.truncateToWidth === "function", "truncateToWidth missing");
});

check("footer: visibleWidth still measures the way the layout assumes", () => {
	assert(tui.visibleWidth("abc") === 3, "ascii width changed");
	assert(tui.visibleWidth("中") === 2, "wide char width changed");
	assert(tui.visibleWidth("\u001b[31mred\u001b[0m") === 3, "ANSI is no longer stripped");
});

check("footer: every icon it actually uses measures one column", () => {
	// Read the real constants rather than a hardcoded copy. The unit tests
	// compare rendered text against this same ICON map, so a glyph swapped for a
	// double-width character satisfies them while overflowing every line.
	const src = readFileSync(join(extRoot, "responsive-footer", "segments.ts"), "utf-8");
	const block = /export const ICON = \{([\s\S]*?)\}/.exec(src);
	assert(block, "could not find the ICON map in segments.ts");
	const icons = [...block[1].matchAll(/(\w+):\s*"((?:[^"\\]|\\.)*)"/g)].map(([, name, raw]) => [
		name,
		JSON.parse(`"${raw}"`),
	]);
	assert(icons.length > 0, "no icons parsed");
	for (const [name, glyph] of icons) {
		const w = tui.visibleWidth(glyph);
		assert(w === 1, `icon '${name}' measures ${w} columns; the layout budgets 1 and lines would overflow`);
	}
	return `${icons.length} icons`;
});

check("footer: theme still defines every colour key used", () => {
	const theme = JSON.parse(readFileSync(join(piPath, "dist/modes/interactive/theme/dark.json"), "utf-8"));
	const colors = theme.colors ?? theme;
	const used = ["accent", "dim", "muted", "success", "warning", "error"];
	const missing = used.filter((k) => !(k in colors));
	assert(missing.length === 0, `missing colour keys: ${missing.join(", ")}`);
	return `${used.length} keys`;
});

// --------------------------------------------------- extension API type shape

check("extension API still declares what the extensions call", () => {
	const dts = readFileSync(join(piPath, "dist/core/extensions/types.d.ts"), "utf-8");
	const required = [
		"setFooter(",
		"getContextUsage()",
		"thinkingLevel?",
		"hasPendingMessages()",
		"switchSession(",
		"registerCommand(",
		"confirm(",
		"notify(",
	];
	const missing = required.filter((sig) => !dts.includes(sig));
	assert(missing.length === 0, `no longer declared: ${missing.join(", ")}`);
	return `${required.length} signatures`;
});

check("footer data provider still exposes branch and statuses", () => {
	const dts = readFileSync(join(piPath, "dist/core/footer-data-provider.d.ts"), "utf-8");
	for (const sig of ["getGitBranch()", "getExtensionStatuses()", "onBranchChange("]) {
		assert(dts.includes(sig), `${sig} missing`);
	}
	// The footer iterates .values(); an array would silently render nothing.
	assert(/getExtensionStatuses\(\):\s*ReadonlyMap/.test(dts), "getExtensionStatuses is no longer a Map");
});

check("session manager still exposes what the footer reads", () => {
	const dts = readFileSync(join(piPath, "dist/core/session-manager.d.ts"), "utf-8");
	for (const sig of ["getBranch(", "getSessionName()", "getSessionFile()"]) {
		assert(dts.includes(sig), `${sig} missing`);
	}
});

// ------------------------------------------------------------- unit + smoke

for (const ext of ["responsive-footer", "cd"]) {
	const dir = join(extRoot, ext);
	if (!existsSync(dir)) continue;

	check(`${ext}: unit tests pass`, () => {
		const out = execFileSync("npm", ["test", "--silent"], { cwd: dir, encoding: "utf-8", stdio: "pipe" });
		const pass = /^[ℹ#]\s*pass (\d+)/m.exec(out)?.[1];
		const fail = /^[ℹ#]\s*fail (\d+)/m.exec(out)?.[1];
		assert(pass !== undefined && fail !== undefined, `could not parse test output:\n${out.slice(-200)}`);
		assert(fail === "0", `${fail} failing test(s)`);
		return `${pass} tests`;
	});

	check(`${ext}: loads in pi`, () => {
		const out = execFileSync(
			"pi",
			["--no-extensions", "-e", dir, "--no-tools", "--no-session", "-p", "reply with exactly: CONTRACT_OK"],
			{ encoding: "utf-8", stdio: "pipe", timeout: 180_000 },
		);
		assert(out.includes("CONTRACT_OK"), `unexpected reply: ${out.trim().slice(0, 120)}`);
	});
}

// ------------------------------------------------------------------- report

const pad = Math.max(...results.map(([, n]) => n.length));
for (const [status, name, detail] of results) {
	const mark = status === "ok" ? "\u001b[32m✓\u001b[0m" : "\u001b[31m✗\u001b[0m";
	console.log(`${mark} ${name.padEnd(pad)}  ${detail}`);
}
console.log(failed === 0 ? "\nAll contracts hold." : `\n${failed} contract(s) broken.`);
process.exit(failed === 0 ? 0 : 1);
