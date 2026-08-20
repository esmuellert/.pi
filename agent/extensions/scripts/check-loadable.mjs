/**
 * Can pi still start with these extensions?
 *
 * Run: pnpm loadable  (part of `pnpm verify`)
 *
 * The tests and the typechecker both passed on a commit that made pi refuse to
 * start: a helper package added under extensions/ held an index.ts, and pi
 * treats any such directory as an extension and demands a factory from it.
 * Nothing in the workspace was in a position to notice, because nothing in the
 * workspace was asking pi.
 *
 * So this asks pi. Discovery and loading are both pi's own -- the rules are
 * not restated here, since restating them is how the last one was missed.
 */

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, sep } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const agentDir = join(here, "..", "..");
// pi is a devDependency of the workspace root because this script needs it.
// Its "exports" does not publish package.json, so resolve the entry point and
// walk up from there rather than asking for a subpath it does not have.
const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const pi = entry.slice(0, entry.indexOf(`${sep}dist${sep}`));
const { discoverAndLoadExtensions } = await import(`file://${join(pi, "dist/core/extensions/loader.js")}`);

const { extensions, errors } = await discoverAndLoadExtensions([], process.cwd(), agentDir);

for (const { path, error } of errors) {
	console.error(`  ✖ ${path.replace(agentDir, "~/.pi")}\n    ${error}`);
}
if (errors.length > 0) {
	console.error(`\n${errors.length} extension(s) would stop pi from starting.`);
	process.exit(1);
}

const names = extensions.map((e) => e.name ?? e.path?.replace(agentDir, "") ?? "?");
console.log(`  ${extensions.length} extensions load: ${names.join(", ")}`);

/*
 * Every workspace package must also be in the repository.
 *
 * .gitignore here is a whitelist -- everything under extensions/ is ignored
 * unless named -- because third-party extensions install themselves alongside
 * ours and must not be committed. The cost is that a new package is invisible
 * to git until someone remembers to add a line, and a commit can claim to add
 * one while adding nothing. That has already happened once.
 */
const workspace = readFileSync(join(here, "..", "pnpm-workspace.yaml"), "utf-8");
const declared = [...workspace.matchAll(/^\s*-\s*"([^"]+)"/gm)].map((m) => m[1]);
const untracked = declared.filter((name) => {
	const result = spawnSync("git", ["ls-files", "--error-unmatch", `${name}/package.json`], {
		cwd: join(here, ".."),
		stdio: "ignore",
	});
	return result.status !== 0;
});
if (untracked.length > 0) {
	console.error(`\n  ✖ workspace packages missing from git: ${untracked.join(", ")}`);
	console.error("    Add them to .gitignore's whitelist, which is what keeps");
	console.error("    third-party extensions out of the repository.");
	process.exit(1);
}
console.log(`  ${declared.length} workspace packages are all tracked`);
