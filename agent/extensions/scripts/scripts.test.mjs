/**
 * Whether the scripts answer the same question the same way however they are run.
 *
 * Run: node scripts/scripts.test.mjs
 *
 * `pnpm run` puts the workspace's node_modules/.bin at the front of PATH, and
 * this workspace depends on pi. So a script that resolves `pi` by name gets the
 * workspace's copy inside a pnpm script and the global one in a shell -- two
 * different versions during an upgrade, because installDeps() has just unpacked
 * the new one locally while the global command is still the old one.
 *
 * That is not a hypothetical. `pnpm upgrade-pi` rewrote the catalog, installed
 * the workspace, then read `pi --version`, saw the version it had just unpacked,
 * skipped the global install and printed "Upgraded". The machine kept running
 * the old pi. Every CI step invoked `node scripts/...` instead, where PATH is
 * ordinary, so nothing caught it.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE = dirname(dirname(fileURLToPath(import.meta.url)));

const WINDOWS = process.platform === "win32";
const viaShell = (command, args) =>
	WINDOWS ? [process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command, ...args]] : [command, args];

/** Run something and return stdout, stderr and status without throwing. */
function attempt(command, args, options = {}) {
	const [bin, argv] = viaShell(command, args);
	try {
		const stdout = execFileSync(bin, argv, {
			cwd: WORKSPACE,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "pipe"],
			...options,
		});
		return { stdout, status: 0 };
	} catch (error) {
		return { stdout: `${error.stdout ?? ""}${error.stderr ?? ""}`, status: error.status ?? 1 };
	}
}

const strip = (text) => text.replace(/\u001b\[[0-9;]*m/g, "");

describe("the scripts read the same pi whoever asks", () => {
	it("has a workspace pi that is not the global one", async () => {
		// The condition the rest of this file is about: pnpm run puts
		// node_modules/.bin first, so `pi` resolved by name inside a pnpm script
		// is this file, not the command the user has. If the workspace ever stops
		// depending on pi, the tests below would pass for the wrong reason.
		//
		// Asserted from the filesystem rather than by printing PATH from a
		// subprocess: passing code as a string means passing it through cmd.exe on
		// Windows, which eats the parentheses. That is the fourth thing in this
		// repository to break that way.
		const local = join(WORKSPACE, "node_modules", ".bin", process.platform === "win32" ? "pi.cmd" : "pi");
		assert.ok(existsSync(local), `${local} does not exist; the workspace no longer depends on pi`);

		const { globalPi } = await import("./environment.mjs");
		const global = globalPi();
		if (global && existsSync(global)) {
			assert.notEqual(
				realpathSync(local),
				realpathSync(global),
				"the workspace and global pi are the same file, so nothing here can disagree",
			);
		}
	});

	it("reports the same installed version through pnpm as directly", () => {
		const direct = attempt("node", ["scripts/setup.mjs", "check"]);
		const viaPnpm = attempt("pnpm", ["check"]);

		const version = (out) => /pi installed\s+(\S+)/.exec(strip(out))?.[1];
		assert.ok(version(direct.stdout), `no version in:\n${direct.stdout}`);
		assert.equal(
			version(viaPnpm.stdout),
			version(direct.stdout),
			"`pnpm check` and the script disagree about which pi is installed",
		);
	});

	it("agrees about whether the machine matches, through either spelling", () => {
		const direct = attempt("node", ["scripts/setup.mjs", "check"]);
		const viaPnpm = attempt("pnpm", ["check"]);
		assert.equal(
			viaPnpm.status === 0,
			direct.status === 0,
			"one spelling says the machine matches the repo and the other does not",
		);
	});

	it("checks the install the same way through either spelling", () => {
		const direct = attempt("node", ["scripts/check-install.mjs"]);
		const viaPnpm = attempt("pnpm", ["exec", "node", "scripts/check-install.mjs"]);
		assert.equal(viaPnpm.status === 0, direct.status === 0);

		const onPath = (out) => /on PATH (\S+)/.exec(strip(out))?.[1];
		assert.equal(onPath(viaPnpm.stdout), onPath(direct.stdout));
	});
});

describe("the global pi is found by path", () => {
	it("resolves to pnpm's global bin directory, not to whatever PATH says", async () => {
		const { globalPi, globalBinDir } = await import("./environment.mjs");
		const path = globalPi();
		if (!path) {
			// No PNPM_HOME: nothing to assert, and the scripts report that
			// separately as an environment problem.
			return;
		}
		assert.ok(path.startsWith(globalBinDir()), `${path} is not under ${globalBinDir()}`);
		assert.doesNotMatch(path, /node_modules/, "the global pi must not resolve into a workspace");
	});
});
