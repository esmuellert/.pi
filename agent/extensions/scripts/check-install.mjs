/**
 * Whether the install this machine just performed is the one the repo asked for.
 *
 * Two things have been silently wrong before, and neither shows up as a failed
 * command: a `pi` on PATH that is not the pinned version, because pnpm moved its
 * global bin directory and the old binary kept winning; and the version that was
 * replaced still unpacked beside the new one, because `pnpm install` adds
 * without removing.
 *
 * A file rather than a `node -e` in the workflow: the regex here has backslashes,
 * and YAML and the shell each take one on the way through.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE = dirname(dirname(fileURLToPath(import.meta.url)));

/** Windows ships pi as a `.cmd` shim, which execFile cannot start. */
const WINDOWS = process.platform === "win32";
const run = (command, args) =>
	execFileSync(
		WINDOWS ? (process.env.ComSpec ?? "cmd.exe") : command,
		WINDOWS ? ["/d", "/s", "/c", command, ...args] : args,
		{ encoding: "utf-8" },
	).trim();

/** What pi on PATH reports, or nothing when there is none. */
function installedVersion() {
	try {
		return run("pi", ["--version"]);
	} catch {
		// A missing pi is one of the things being checked for, so it is reported
		// rather than thrown -- execFileSync's ENOENT stack says spawnSync and a
		// path, and nothing about what the caller wanted.
		return undefined;
	}
}

const PI_PACKAGES = ["pi-coding-agent", "pi-tui", "pi-ai"];

const yaml = readFileSync(join(WORKSPACE, "pnpm-workspace.yaml"), "utf-8");
const pinned = /"@earendil-works\/pi-coding-agent":\s*(\S+)/.exec(yaml)?.[1];
if (!pinned) {
	console.error("no pi version in the catalog");
	process.exit(1);
}

const failures = [];

// All three or none. pi-coding-agent@X depends on pi-tui@^X and pi-ai@^X, so a
// catalog naming different versions resolves two of each and the workspace ends
// up with the ambiguity this file exists to forbid. An upgrade rewrites three
// lines, and nothing else notices if it rewrites one.
for (const pkg of PI_PACKAGES) {
	const line = new RegExp(`"@earendil-works/${pkg}":\\s*(\\S+)`);
	const says = line.exec(yaml)?.[1];
	if (says !== pinned) {
		failures.push(`the catalog pins ${pkg} at ${says ?? "nothing"}, not ${pinned}`);
	}
}

const installed = installedVersion();
console.log(`  pinned ${pinned}, on PATH ${installed ?? "nothing"}`);
if (installed !== pinned) {
	failures.push(installed ? `pi on PATH is ${installed}, not the pinned ${pinned}` : "no pi on PATH");
}

const store = readdirSync(join(WORKSPACE, "node_modules/.pnpm"));
for (const pkg of PI_PACKAGES) {
	const prefix = `@earendil-works+${pkg}@`;
	const found = [
		...new Set(
			store
				.filter((entry) => entry.startsWith(prefix))
				.map((entry) => entry.slice(prefix.length).split("_")[0]),
		),
	];
	console.log(`  ${pkg}: ${found.join(", ") || "none"}`);
	if (found.length !== 1 || found[0] !== pinned) {
		failures.push(`${pkg} has ${found.length} version(s) unpacked: ${found.join(", ")}`);
	}
}

if (failures.length > 0) {
	console.error("");
	for (const failure of failures) console.error(`  x ${failure}`);
	process.exit(1);
}
console.log("\n  the install matches the catalog");
