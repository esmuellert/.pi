#!/usr/bin/env node
/**
 * Fail when the catalog no longer pins the pi that is installed.
 *
 * That mismatch is the whole point of pinning: a pi upgrade should stop the
 * build and say so, rather than let type checking stay green against types
 * nobody is running.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = dirname(dirname(fileURLToPath(import.meta.url)));
const catalog = readFileSync(join(workspace, "pnpm-workspace.yaml"), "utf-8");
const pinned = /"@earendil-works\/pi-coding-agent":\s*(\S+)/.exec(catalog)?.[1];

if (!pinned) {
	console.error("pi is not pinned in the pnpm catalog");
	process.exit(1);
}

const installed = execFileSync("pi", ["--version"], { encoding: "utf-8" }).trim();

if (pinned !== installed) {
	console.error(
		`pi ${installed} is installed but the catalog pins ${pinned}.\n` +
			`Update the three @earendil-works entries in pnpm-workspace.yaml, then:\n` +
			`  pnpm install && pnpm verify`,
	);
	process.exit(1);
}

console.log(`pi ${installed} matches the catalog`);
