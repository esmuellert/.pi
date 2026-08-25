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
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { globalPiIsReachable, inspect } from "./environment.mjs";

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
 * node_modules is in step with the catalog when every pi package is unpacked at
 * the pinned version and no other version of one is left behind.
 *
 * Checking only that the new version arrived misses the case that matters after
 * an upgrade: pnpm leaves the old copy in the store until something prunes it,
 * so a workspace can hold two versions of the same package and resolve to
 * either. pnpm appends a peer-dependency suffix to the directory name, so the
 * version is read back off the name rather than matched as a whole.
 */
function unpackedVersions(store, pkg) {
	const prefix = `${pkg.replace("/", "+")}@`;
	return readdirSync(store)
		.filter((entry) => entry.startsWith(prefix))
		.map((entry) => entry.slice(prefix.length).split("_")[0]);
}

function depsMatch(pinned) {
	const store = join(WORKSPACE, "node_modules/.pnpm");
	if (!existsSync(store)) return false;
	return PI_PACKAGES.every((pkg) => {
		const found = unpackedVersions(store, pkg);
		return found.length === 1 && found[0] === pinned;
	});
}

/** Every pi version unpacked in node_modules, for reporting drift. */
function strayVersions(pinned) {
	const store = join(WORKSPACE, "node_modules/.pnpm");
	if (!existsSync(store)) return [];
	const stray = new Set();
	for (const pkg of PI_PACKAGES) {
		for (const found of unpackedVersions(store, pkg)) if (found !== pinned) stray.add(found);
	}
	return [...stray].sort();
}

function pnpm() {
	// corepack ships with node, so a fresh machine needs nothing installed.
	return capture("pnpm", ["--version"]) ? ["pnpm", []] : ["corepack", ["pnpm"]];
}

function installGlobalPi(version) {
	const [bin, prefix] = pnpm();
	run(bin, [...prefix, "add", "-g", `${PI_PACKAGE}@${version}`]);
	// pnpm reports success for an install whose directory nothing on PATH points
	// at, which is how a machine ends up running an old pi after upgrading.
	if (!globalPiIsReachable()) {
		fail("pi was installed but is not on PATH. Run `pnpm setup --force`, open a new shell, and try again.");
	}
}

/**
 * Stop before touching anything when the machine cannot carry the install.
 *
 * node and pnpm are the user's to install and configure: a script that edits a
 * shell profile has to guess which one, when it is read, and what else is in it.
 */
function requireEnvironment() {
	const problems = inspect();
	if (problems.length === 0) return;
	console.error(`\n${red("this machine is not ready")}`);
	for (const problem of problems) {
		console.error(`\n  ${problem.what}`);
		console.error(`  ${cyan("fix")}  ${problem.fix}`);
		if (problem.because) console.error(`  ${dim(problem.because.replace(/\s+/g, " "))}`);
	}
	console.error("");
	process.exit(1);
}

/**
 * Install, then prune.
 *
 * `pnpm install` adds the pinned version and leaves the previous one unpacked in
 * the store, so a workspace comes out of an upgrade holding both. That is the
 * "old node_modules after upgrading" that made a Windows upgrade need manual
 * cleanup: nothing was broken, but two versions were resolvable.
 */
function installDeps() {
	const [bin, prefix] = pnpm();
	run(bin, [...prefix, "install"]);
	run(bin, [...prefix, "prune"]);
}

/**
 * Prove the install works.
 *
 * `verify` includes smoke tests, which start pi and call a real model, so on a
 * machine that has not logged in they fail for a reason that has nothing to do
 * with the install. Those run only where credentials exist; everywhere else the
 * tests and typechecks still run, and the smoke tests are named as skipped
 * rather than passed.
 */
function verify() {
	const [bin, prefix] = pnpm();
	if (hasCredentials()) {
		run(bin, [...prefix, "run", "verify"]);
		return;
	}
	run(bin, [...prefix, "run", "test"]);
	run(bin, [...prefix, "run", "typecheck"]);
	run(bin, [...prefix, "loadable"]);
	skip("smoke tests", "no credentials yet -- run `pi login`, then `pnpm smoke`");
}

/** True when pi has something to authenticate with. */
function hasCredentials() {
	if (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) return true;
	const agentDir = process.env.PI_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	return existsSync(join(agentDir, "auth.json"));
}

// ----------------------------------------------------------------- actions

function check() {
	const pinned = readPinned();
	const installed = readInstalled();
	console.log(`\n${cyan("state")}`);
	info(`catalog pins  ${pinned ?? red("nothing")}`);
	info(`pi installed  ${installed ?? red("not found")}`);
	if (depsMatch(pinned)) info("workspace deps match the catalog");
	else {
		const stray = strayVersions(pinned);
		info(`workspace deps ${red("out of date")}${stray.length ? dim(`  (${stray.join(", ")} still unpacked)`) : ""}`);
	}

	if (!pinned) fail("no pi version in the catalog");
	if (installed !== pinned || !depsMatch(pinned)) {
		console.log(`\nRun ${cyan("node scripts/setup.mjs bootstrap")} to make this machine match.`);
		process.exit(1);
	}
	console.log(`\nThis machine matches the repo.`);
}

function bootstrap() {
	requireEnvironment();
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


	console.log(`\n${cyan("verify")}`);
	verify();
	console.log(`\nThis machine matches the repo.`);
}

function upgrade(requested) {
	requireEnvironment();
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
