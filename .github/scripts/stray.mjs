/**
 * Leave a second version of a pi package unpacked, on purpose.
 *
 * check-install.mjs refuses a workspace holding two versions of the same pi
 * package, because pnpm install adds without removing and a workspace that holds
 * both resolves to either. On a machine that has never held two, that check
 * cannot be distinguished from one that always passes.
 *
 * So one is put there. The version comes from the same history arrange.mjs uses:
 * the newest commit whose catalog pins something other than HEAD's.
 *
 *   node .github/scripts/stray.mjs
 */

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const EXTENSIONS = "agent/extensions";
const WORKSPACE = join(REPO, EXTENSIONS);
const CATALOG = `${EXTENSIONS}/pnpm-workspace.yaml`;
const PI_PACKAGE = "@earendil-works/pi-coding-agent";

const WINDOWS = process.platform === "win32";
const viaShell = (command, args) =>
	WINDOWS ? [process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command, ...args]] : [command, args];

function fail(message) {
	console.error(`\nstray failed: ${message}`);
	process.exit(1);
}

function run(command, args, cwd = WORKSPACE) {
	const [bin, argv] = viaShell(command, args);
	const result = spawnSync(bin, argv, { cwd, stdio: "inherit" });
	if (result.status !== 0) fail(`${command} ${args.join(" ")} exited ${result.status}`);
}

function capture(command, args, cwd = REPO) {
	const [bin, argv] = viaShell(command, args);
	return execFileSync(bin, argv, { cwd, encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 }).trim();
}

const pinnedIn = (yaml) => /"@earendil-works\/pi-coding-agent":\s*(\S+)/.exec(yaml)?.[1];

const target = pinnedIn(readFileSync(join(REPO, CATALOG), "utf-8"));
if (!target) fail("no pi version in the catalog");

const history = capture("git", ["log", "--format=%H", "--", CATALOG]).split("\n").filter(Boolean);
let previous;
for (const commit of history) {
	const was = pinnedIn(capture("git", ["show", `${commit}:${CATALOG}`]));
	if (was && was !== target) {
		previous = was;
		break;
	}
}
if (!previous) fail(`no commit pins a pi other than ${target}; a shallow checkout cannot see one`);

console.log(`\n  unpacking ${PI_PACKAGE}@${previous} beside the pinned ${target}\n`);
// -w so it lands in the workspace root rather than a member. `pnpm add` writes
// the lockfile by definition, so it takes no frozen-lockfile option and
// rejects one.
run("pnpm", ["add", "-w", `${PI_PACKAGE}@${previous}`]);
