/**
 * Put this machine in the state a machine is in before an upgrade.
 *
 * A fresh runner has no pi and no node_modules, so bootstrap takes its two
 * "install from nothing" branches and the upgrade path is never touched. What
 * has to be arranged instead is a machine that has been running an older pi for
 * a while: an older pi on PATH, and that version unpacked in the workspace.
 *
 * The old state comes out of git history rather than being constructed by
 * pinning the catalog backwards. Those are not the same thing, and the
 * difference is not cosmetic: pi-coding-agent@X depends on pi-tui@^X, so pinning
 * the catalog to an older X today resolves pi-tui to the newest patch that still
 * matches -- leaving two versions unpacked, which is a state no real machine has
 * ever been in and which the checks under test would rightly reject. The commit
 * that pinned that version has a lockfile from when it was the newest, and that
 * lockfile is consistent.
 *
 *   node .github/scripts/arrange.mjs pull      leave the repo at HEAD
 *   node .github/scripts/arrange.mjs upgrade   leave the catalog behind too
 *
 * `pull` is every machine but one: someone else moved the repo forward, you
 * pulled, and your node_modules and your pi are still last week's.
 *
 * `upgrade` is the one machine that moves it: current code, current tests, but a
 * catalog that still names the old version, which is what `setup.mjs upgrade` is
 * handed.
 *
 * The old pi is installed from the old tree, because that tree's lockfile is
 * consistent -- when it was written, the version it names was the newest, and
 * pi-coding-agent@X depending on pi-tui@^X resolved to X. Pinning today's
 * catalog backwards instead would resolve pi-tui to a newer patch that still
 * matches and unpack two versions, which is a state no machine has been in and
 * which the checks under test would rightly reject.
 *
 * Only the version lines come back for `upgrade` mode, though, not the old
 * catalog. An old tree carries its old mistakes: the commit before this one
 * named a platform in supportedArchitectures rather than `current`, so checking
 * it out whole installs darwin binaries onto a Linux runner and typecheck fails
 * for a reason that has nothing to do with upgrading.
 *
 * Nothing here verifies. The old state is being arranged, not asserted: running
 * today's suite against an older pi would fail for reasons belonging to that pi.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const EXTENSIONS = "agent/extensions";
const WORKSPACE = join(REPO, EXTENSIONS);
const CATALOG = `${EXTENSIONS}/pnpm-workspace.yaml`;
const PI_PACKAGES = ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"];
const PI_PACKAGE = "@earendil-works/pi-coding-agent";

/** Windows ships pnpm, npm, git and pi as .cmd shims, which execFile cannot start. */
const WINDOWS = process.platform === "win32";
const viaShell = (command, args) =>
	WINDOWS ? [process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command, ...args]] : [command, args];

function fail(message) {
	console.error(`\narrange failed: ${message}`);
	process.exit(1);
}

function run(command, args, cwd = WORKSPACE) {
	const [bin, argv] = viaShell(command, args);
	const result = spawnSync(bin, argv, { cwd, stdio: "inherit" });
	if (result.error) fail(`${command} could not be started: ${result.error.message}`);
	if (result.status !== 0) fail(`${command} ${args.join(" ")} exited ${result.status}`);
}

function capture(command, args, cwd = WORKSPACE) {
	const [bin, argv] = viaShell(command, args);
	return execFileSync(bin, argv, { cwd, encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 }).trim();
}

const pinnedIn = (yaml) => /"@earendil-works\/pi-coding-agent":\s*(\S+)/.exec(yaml)?.[1];

/** Every version of a pi package unpacked in the workspace store. */
function unpacked(pkg) {
	const prefix = `${pkg.replace("/", "+")}@`;
	return [
		...new Set(
			readdirSync(join(WORKSPACE, "node_modules/.pnpm"))
				.filter((entry) => entry.startsWith(prefix))
				.map((entry) => entry.slice(prefix.length).split("_")[0]),
		),
	];
}

// -------------------------------------------------------------- which commit

const mode = process.argv[2];
if (mode !== "pull" && mode !== "upgrade") fail("usage: arrange.mjs pull|upgrade");

const target = pinnedIn(readFileSync(join(REPO, CATALOG), "utf-8"));
if (!target) fail("no pi version in the catalog");

const history = capture("git", ["log", "--format=%H", "--", CATALOG], REPO).split("\n").filter(Boolean);
let source;
let previous;
for (const commit of history) {
	const was = pinnedIn(capture("git", ["show", `${commit}:${CATALOG}`], REPO));
	if (was && was !== target) {
		source = commit;
		previous = was;
		break;
	}
}
if (!source) {
	fail(
		`no commit in the history of ${CATALOG} pins a pi other than ${target}. ` +
			`If the checkout is shallow, the workflow needs fetch-depth: 0.`,
	);
}

console.log(`\n  arrange a machine at pi ${previous}, from ${source.slice(0, 7)}, for ${mode} to ${target}\n`);

// -------------------------------------------------------------- old machine

// The whole directory, not just the catalog: --frozen-lockfile compares the
// lockfile against every package.json in the workspace, and HEAD may have added
// one the old lockfile has never heard of.
run("git", ["checkout", source, "--", EXTENSIONS], REPO);
run("pnpm", ["install", "--frozen-lockfile"]);
run("pnpm", ["add", "-g", `${PI_PACKAGE}@${previous}`]);

const installed = capture("pi", ["--version"]);
if (installed !== previous) fail(`pi reports ${installed}, expected ${previous}`);

for (const pkg of PI_PACKAGES) {
	const found = unpacked(pkg);
	console.log(`  ${pkg}: ${found.join(", ")}`);
	// If the old state already held two versions, whatever the upgrade leaves
	// behind could not be attributed to the upgrade.
	if (found.length !== 1 || found[0] !== previous) {
		fail(`expected only ${previous} of ${pkg}, found ${found.join(", ") || "none"}`);
	}
}

// ------------------------------------------------------------- now pull HEAD

run("git", ["checkout", "HEAD", "--", EXTENSIONS], REPO);
if (mode === "upgrade") {
	// HEAD's catalog with the old versions written back into it: the one machine
	// that moves the repo has current settings and a stale pin, not a stale file.
	const path = join(REPO, CATALOG);
	let yaml = readFileSync(path, "utf-8");
	for (const name of PI_PACKAGES) {
		const line = new RegExp(`("${name.replace("/", "\\/")}":\\s*)\\S+`);
		if (!line.test(yaml)) fail(`${name} is not in the catalog`);
		yaml = yaml.replace(line, `$1${previous}`);
	}
	writeFileSync(path, yaml, "utf-8");
	console.log(`  the catalog names ${previous}, everything else is HEAD's`);
}

if (process.env.GITHUB_ENV) {
	appendFileSync(process.env.GITHUB_ENV, `PI_TARGET=${target}\nPI_PREVIOUS=${previous}\n`);
}
console.log(
	`\n  pi ${previous} is on PATH and unpacked; the repo ${mode === "pull" ? `pins ${target}` : `will be upgraded to ${target}`}`,
);
