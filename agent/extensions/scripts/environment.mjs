/**
 * Whether this machine can install and run pi, and what to do when it cannot.
 *
 * node and pnpm are the user's to install and configure. This only reports what
 * is wrong and the exact command that fixes it -- a script that edits a shell
 * profile has to guess which one, when it is read, and what else is in it, and
 * gets all three wrong on some machine.
 *
 * Every check here is one that has actually failed on this setup. pnpm's own
 * errors for them name an internal condition rather than the thing to change:
 * "ERR_PNPM_NO_GLOBAL_BIN_DIR" for a PATH that is one directory off, and
 * "cannot find binary path" from turbo for a pnpm that exists only as a corepack
 * shim.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, resolve } from "node:path";

/**
 * One thing that is wrong: `{ what, fix, because }`. `because` is printed under
 * the fix when the cause is not obvious from the command.
 */

/** What ran, if it ran at all. */
function version(command, args) {
	try {
		return execFileSync(command, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return undefined;
	}
}

/** True when `dir` is on PATH, comparing resolved paths rather than strings. */
export function onPath(dir, path = process.env.PATH ?? "") {
	const wanted = resolve(dir);
	return path.split(delimiter).filter(Boolean).some((entry) => {
		try {
			return resolve(entry) === wanted;
		} catch {
			return false;
		}
	});
}

/**
 * Where `pnpm add -g` will put executables.
 *
 * pnpm moved this from `$PNPM_HOME/bin` to `$PNPM_HOME` itself. A machine set up
 * before the move keeps the old directory on PATH, so a global install succeeds
 * and the old binary keeps being the one that runs -- with no error anywhere.
 */
export function globalBinDir() {
	const home = process.env.PNPM_HOME;
	if (!home) return undefined;
	const asked = version("pnpm", ["config", "get", "global-bin-dir"]);
	return asked && asked !== "undefined" ? asked : home;
}

/** Everything wrong with this machine, worst first. */
export function inspect() {
	const problems = [];

	if (!version("node", ["--version"])) {
		problems.push({ what: "node is not installed", fix: "install Node.js 22 or newer" });
		return problems;
	}

	const pnpmVersion = version("pnpm", ["--version"]);
	if (!pnpmVersion) {
		problems.push({
			what: "pnpm is not on PATH",
			fix: "corepack enable && corepack prepare pnpm@latest --activate",
			because: "corepack ships with node; `corepack pnpm` alone is not enough, "
				+ "because turbo looks for a real `pnpm` on PATH and reports "
				+ "\"cannot find binary path\" when it finds none",
		});
		return problems;
	}

	const home = process.env.PNPM_HOME;
	if (!home) {
		problems.push({
			what: "PNPM_HOME is not set, so pnpm has nowhere to install global commands",
			fix: "pnpm setup, then open a new shell",
		});
		return problems;
	}

	const bin = globalBinDir();
	if (bin && !onPath(bin)) {
		const stale = onPath(`${home}/bin`);
		problems.push({
			what: `pnpm installs global commands into ${bin}, which is not on PATH`,
			fix: "pnpm setup --force, then open a new shell",
			because: stale
				? `${home}/bin is on PATH instead. pnpm moved its global bin directory up one `
					+ "level, so an install succeeds and the command that runs is still the old one"
				: undefined,
		});
	}

	return problems;
}

/** True when a global pi would actually be the one that runs. */
export function globalPiIsReachable() {
	const bin = globalBinDir();
	if (!bin) return false;
	const candidate = process.platform === "win32" ? `${bin}\\pi.cmd` : `${bin}/pi`;
	return existsSync(candidate) && onPath(bin);
}
