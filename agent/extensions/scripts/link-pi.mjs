#!/usr/bin/env node
/**
 * Point node_modules/@earendil-works/* at the pi that is actually installed.
 *
 * pi is a global install, so it is not resolvable from this workspace, and
 * TypeScript therefore cannot see the types the extensions import. Adding pi as
 * a normal devDependency would install a second copy that could drift from the
 * one that runs, so instead we symlink the real thing.
 *
 * Runs as a postinstall hook because pnpm prunes anything in node_modules that
 * is not in a manifest — links made before an install do not survive it.
 */

import { accessSync, constants as fsConstants, existsSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LINKED = ["pi-coding-agent", "pi-tui", "pi-ai"];

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
	if (!shim) throw new Error("no pi on PATH outside this workspace");
	const match = new RegExp(SHIM_PATTERN).exec(readFileSync(shim, "utf-8"));
	if (!match) throw new Error(`could not find the package path inside ${shim}`);
	const root = match[1].replace(/\$basedir/g, dirname(shim));
	if (!existsSync(join(root, "package.json"))) throw new Error(`resolved ${root}, but it has no package.json`);
	return realpathSync(resolve(root));
}

const workspace = dirname(dirname(fileURLToPath(import.meta.url)));
const scope = join(workspace, "node_modules", "@earendil-works");

let piRoot;
try {
	piRoot = findPiRoot();
} catch (err) {
	// A missing pi should not break `pnpm install`; typecheck will report it.
	console.warn(`link-pi: skipped (${err instanceof Error ? err.message : err})`);
	process.exit(0);
}

const siblings = dirname(piRoot);
mkdirSync(scope, { recursive: true });

const linked = [];
for (const name of LINKED) {
	const target = join(siblings, name);
	if (!existsSync(target)) {
		console.warn(`link-pi: ${name} not found next to pi, skipping`);
		continue;
	}
	const link = join(scope, name);
	// Replace rather than skip: after `pi update` the store path changes.
	if (existsSync(link) || isDeadLink(link)) rmSync(link, { recursive: true, force: true });
	symlinkSync(target, link, "dir");
	linked.push(name);
}

function isDeadLink(p) {
	try {
		readlinkSync(p);
		return true;
	} catch {
		return false;
	}
}

const version = JSON.parse(readFileSync(join(piRoot, "package.json"), "utf-8")).version;
console.log(`link-pi: linked ${linked.join(", ")} -> pi ${version}`);
