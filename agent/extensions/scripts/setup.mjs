#!/usr/bin/env node
/**
 * Bring a machine in line with this repo, or move the repo to a new pi.
 *
 * The catalog in pnpm-workspace.yaml is the source of truth for which pi these
 * extensions target. Everything here is idempotent: each step reports what it
 * found, and only acts when the machine does not already match.
 *
 *   node scripts/setup.mjs check              report state, change nothing
 *   node scripts/setup.mjs bootstrap          make this machine match the repo
 *   node scripts/setup.mjs upgrade [version]  move the repo to a new pi, then verify
 *
 * Taking over an existing ~/.pi is deliberately not here: you would need this
 * script before you had the repo that contains it. The README has those steps.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE = dirname(dirname(fileURLToPath(import.meta.url)));
const CATALOG = join(WORKSPACE, "pnpm-workspace.yaml");
const PI_PACKAGES = ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"];
const PI_PACKAGE = "@earendil-works/pi-coding-agent";

const USAGE = `
  node scripts/setup.mjs check              report state, change nothing
  node scripts/setup.mjs bootstrap          make this machine match the repo
  node scripts/setup.mjs upgrade [version]  move the repo to a new pi, then verify
`;

const cyan = (s) => `\u001b[36m${s}\u001b[0m`;
const dim = (s) => `\u001b[2m${s}\u001b[0m`;
const red = (s) => `\u001b[31m${s}\u001b[0m`;

const skip = (what, why) => console.log(`  ${dim("skip")}  ${what} ${dim(`(${why})`)}`);
const done = (what) => console.log(`  ${cyan("done")}  ${what}`);
const info = (what) => console.log(`  ${dim("····")}  ${what}`);

function fail(message) {
	console.error(`\n${red("setup failed")}: ${message}`);
	process.exit(1);
}

/**
 * Windows ships pi, pnpm, corepack and npm as .cmd shims rather than as
 * executables, and neither spawn nor execFile can start one: they look for an
 * image to run and report ENOENT. Every command here is one of those, so on
 * Windows they are reached through the interpreter. Naming it explicitly rather
 * than passing `shell: true` keeps the arguments a real argv, which is what
 * that option is deprecated for not doing.
 */
const WINDOWS = process.platform === "win32";
const viaShell = (command, args) =>
	WINDOWS ? [process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command, ...args]] : [command, args];

/** Run a command, streaming output, and fail the script if it does. */
function run(command, args, options = {}) {
	const [bin, argv] = viaShell(command, args);
	const result = spawnSync(bin, argv, { cwd: WORKSPACE, stdio: "inherit", ...options });
	if (result.error) fail(`${command} could not be started: ${result.error.message}`);
	if (result.status !== 0) fail(`${command} ${args.join(" ")} exited ${result.status}`);
}

/** Capture a command's stdout, or undefined if it cannot run at all. */
function capture(command, args) {
	try {
		const [bin, argv] = viaShell(command, args);
		return execFileSync(bin, argv, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return undefined;
	}
}

// ------------------------------------------------------------------- state

const readPinned = () => /"@earendil-works\/pi-coding-agent":\s*(\S+)/.exec(readFileSync(CATALOG, "utf-8"))?.[1];
const readInstalled = () => capture("pi", ["--version"]);

/**
 * node_modules is in step with the catalog when the pinned pi is unpacked
 * there. pnpm appends a peer-dependency suffix to the directory name, so this
 * matches on the prefix rather than the exact name.
 */
function depsMatch(pinned) {
	const store = join(WORKSPACE, "node_modules/.pnpm");
	if (!existsSync(store)) return false;
	const prefix = `${PI_PACKAGE.replace("/", "+")}@${pinned}`;
	return readdirSync(store).some((entry) => entry === prefix || entry.startsWith(`${prefix}_`));
}

function pnpm() {
	// corepack ships with node, so a fresh machine needs nothing installed.
	return capture("pnpm", ["--version"]) ? ["pnpm", []] : ["corepack", ["pnpm"]];
}

function installGlobalPi(version) {
	if (!process.env.PNPM_HOME) {
		fail("PNPM_HOME is not set, so pnpm cannot install globally. Run 'pnpm setup' first, then retry.");
	}
	const [bin, prefix] = pnpm();
	run(bin, [...prefix, "add", "-g", `${PI_PACKAGE}@${version}`]);
}

function installDeps() {
	const [bin, prefix] = pnpm();
	run(bin, [...prefix, "install"]);
}

function verify() {
	const [bin, prefix] = pnpm();
	run(bin, [...prefix, "run", "verify"]);
}

// ----------------------------------------------------------------- actions

function check() {
	const pinned = readPinned();
	const installed = readInstalled();
	console.log(`\n${cyan("state")}`);
	info(`catalog pins  ${pinned ?? red("nothing")}`);
	info(`pi installed  ${installed ?? red("not found")}`);
	info(`workspace deps ${depsMatch(pinned) ? "match the catalog" : red("out of date")}`);

	if (!pinned) fail("no pi version in the catalog");
	if (installed !== pinned || !depsMatch(pinned)) {
		console.log(`\nRun ${cyan("node scripts/setup.mjs bootstrap")} to make this machine match.`);
		process.exit(1);
	}
	console.log(`\nThis machine matches the repo.`);
}

function bootstrap() {
	const pinned = readPinned();
	if (!pinned) fail("no pi version in the catalog");
	console.log(`\n${cyan("bootstrap")} to pi ${pinned}`);

	const installed = readInstalled();
	if (installed === pinned) skip("install pi globally", `already ${pinned}`);
	else {
		info(installed ? `pi ${installed} is installed, replacing with ${pinned}` : "pi is not installed");
		installGlobalPi(pinned);
		const now = readInstalled();
		if (now !== pinned) fail(`installed pi reports ${now}, expected ${pinned}`);
		done(`install pi ${pinned}`);
	}

	if (depsMatch(pinned)) skip("install workspace deps", "already in step with the catalog");
	else {
		installDeps();
		done("install workspace deps");
	}

	installSkills();

	console.log(`\n${cyan("verify")}`);
	verify();
	console.log(`\nThis machine matches the repo.`);
}

/**
 * Install what the skills need.
 *
 * A skill is not a workspace package. turbo refuses a member outside its own
 * root, and moving the root up to agent/ would put a node_modules and a
 * package.json beside pi's sessions, auth and trust files. A skill is also a
 * portable thing -- self-contained dependencies are what let it be copied
 * somewhere else -- and it needs none of what the workspace gives the
 * extensions: no TypeScript, no build, no pi version contract.
 *
 * So it installs itself, and this is what keeps that on the one path a fresh
 * machine follows.
 */
function installSkills() {
	const skills = join(dirname(WORKSPACE), "skills");
	if (!existsSync(skills)) return;
	const [bin, prefix] = pnpm();
	for (const entry of readdirSync(skills, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const dir = join(skills, entry.name);
		if (!existsSync(join(dir, "package.json"))) continue;
		run(bin, [...prefix, "--dir", dir, "install", "--silent"]);
		done(`install ${entry.name} skill deps`);
	}
}

function upgrade(requested) {
	const pinned = readPinned();
	if (!pinned) fail("no pi version in the catalog");

	const target = requested ?? capture("npm", ["view", PI_PACKAGE, "version"]);
	if (!target) fail("could not resolve the latest pi version from npm");
	console.log(`\n${cyan("upgrade")} ${pinned} -> ${target}`);

	if (target === pinned) skip("update the catalog", `already pinned to ${target}`);
	else {
		let yaml = readFileSync(CATALOG, "utf-8");
		for (const name of PI_PACKAGES) {
			const line = new RegExp(`("${name.replace("/", "\\/")}":\\s*)\\S+`);
			if (!line.test(yaml)) fail(`${name} is not in the catalog`);
			yaml = yaml.replace(line, `$1${target}`);
		}
		writeFileSync(CATALOG, yaml, "utf-8");
		done(`pin ${PI_PACKAGES.length} packages to ${target}`);
	}

	if (depsMatch(target)) skip("install workspace deps", "already in step with the catalog");
	else {
		installDeps();
		done("install workspace deps");
	}

	if (readInstalled() === target) skip("install pi globally", `already ${target}`);
	else {
		installGlobalPi(target);
		done(`install pi ${target}`);
	}

	console.log(`\n${cyan("verify")}`);
	try {
		verify();
	} catch {
		// verify() exits on failure; this is here for clarity if that changes.
		fail("the extensions do not pass against the new pi");
	}
	console.log(`\nUpgraded to pi ${target}. Commit pnpm-workspace.yaml and pnpm-lock.yaml.`);
}

// -------------------------------------------------------------------- main

const [action, argument] = process.argv.slice(2);
switch (action) {
	case "check":
		check();
		break;
	case "bootstrap":
		bootstrap();
		break;
	case "upgrade":
		upgrade(argument);
		break;
	default:
		console.log(USAGE);
		process.exit(action ? 1 : 0);
}
