/**
 * Run a command that is supposed to fail, and fail if it does not.
 *
 * A check that reports a problem is only worth having if it stays silent when
 * there is none, and the only way to know it does is to hand it a problem. Those
 * assertions are inverted -- non-zero is the pass -- which is a shape shell
 * makes easy and YAML does not: written as `if cmd; then exit 1; fi` a workflow
 * runs it under bash on Linux and PowerShell on Windows, where it is a syntax
 * error. This is the third thing in these workflows to break that way.
 *
 *   node .github/scripts/must-fail.mjs <cwd> <expected text> -- <command> [args]
 *
 * <cwd> is relative to the repository root. <expected text> must appear in the
 * output, so that a command failing for an unrelated reason is not mistaken for
 * the failure being asked about; pass "" to accept any failure.
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const argv = process.argv.slice(2);
const split = argv.indexOf("--");
if (split < 2) {
	console.error("usage: must-fail.mjs <cwd> <expected text> -- <command> [args]");
	process.exit(1);
}
const [where, expected] = argv.slice(0, split);
const [command, ...args] = argv.slice(split + 1);

/** Windows ships node's neighbours as .cmd shims, which spawn cannot start. */
const WINDOWS = process.platform === "win32";
const [bin, real] = WINDOWS
	? [process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command, ...args]]
	: [command, args];

const result = spawnSync(bin, real, { cwd: join(REPO, where), encoding: "utf-8" });
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
process.stdout.write(output);

if (result.error) {
	console.error(`\n  ${command} could not be started: ${result.error.message}`);
	process.exit(1);
}
if (result.status === 0) {
	console.error(`\n  ${command} ${args.join(" ")} succeeded, and was supposed to fail`);
	process.exit(1);
}
if (expected && !output.includes(expected)) {
	console.error(`\n  it failed, but not about "${expected}" -- so it may have failed for another reason`);
	process.exit(1);
}
console.log(`\n  failed as it should${expected ? `, saying "${expected}"` : ""}`);
