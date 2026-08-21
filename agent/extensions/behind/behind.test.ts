/**
 * Counting how far a checkout is behind, against real repositories.
 *
 * Run: pnpm test
 *
 * Built rather than mocked, because the case that matters -- being behind --
 * is exactly the case where git's own behaviour is surprising: the remote's
 * commits are not in the checkout, so anything that only compares hashes
 * cannot count them.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { behind, summarise } from "./behind.ts";

let root: string;
const git = (cwd: string, ...args: string[]) =>
	execFileSync("git", args, { cwd, encoding: "utf-8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();

/**
 * A remote with three commits, and a clone sitting `back` commits behind it.
 *
 * Each call gets its own directories: naming them after `back` meant two tests
 * asking for the same distance collided.
 */
let made = 0;
function checkout(back: number): string {
	const id = `${back}-${made++}`;
	const remote = join(root, `remote-${id}.git`);
	git(root, "init", "-q", "--bare", remote);
	const work = join(root, `work-${id}`);
	git(root, "clone", "-q", remote, work);
	for (const message of ["first", "second", "third"]) git(work, "commit", "-q", "--allow-empty", "-m", message);
	git(work, "push", "-q", "origin", "HEAD:refs/heads/main");
	const clone = join(root, `clone-${id}`);
	git(root, "clone", "-q", remote, clone);
	if (back > 0) git(clone, "reset", "-q", "--hard", `HEAD~${back}`);
	return clone;
}

describe("counting", () => {
	before(() => {
		root = mkdtempSync(join(tmpdir(), "behind-"));
	});
	after(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("counts commits the checkout does not have yet", async () => {
		// The commits are genuinely absent -- a reset --hard drops them -- which
		// is what a checkout that has not pulled looks like.
		assert.deepEqual(await behind(checkout(2)), { kind: "behind", commits: 2, branch: "main" });
	});

	it("says nothing when there is nothing to say", async () => {
		assert.deepEqual(await behind(checkout(0)), { kind: "current" });
	});

	it("leaves the checkout as it found it", async () => {
		const clone = checkout(2);
		const head = git(clone, "rev-parse", "HEAD");
		const status = git(clone, "status", "--porcelain");
		await behind(clone);
		assert.equal(git(clone, "rev-parse", "HEAD"), head, "HEAD moved");
		assert.equal(git(clone, "status", "--porcelain"), status, "the working tree changed");
	});

	it("reports rather than throws when there is no repository", async () => {
		const state = await behind(tmpdir());
		assert.equal(state.kind, "unknown");
	});

	it("reports rather than throws when the remote is unreachable", async () => {
		const clone = checkout(1);
		git(clone, "remote", "set-url", "origin", join(root, "no-such-remote.git"));
		const state = await behind(clone, 4000);
		assert.equal(state.kind, "unknown");
	});
});

describe("what the line says", () => {
	it("names the repository, the count, and what to do", () => {
		assert.equal(summarise({ kind: "behind", commits: 3, branch: "main" }, ".pi"), ".pi is 3 commits behind main — git pull");
	});

	it("says one commit rather than 1 commits", () => {
		assert.match(summarise({ kind: "behind", commits: 1, branch: "main" }, ".pi")!, /\b1 commit\b/);
	});

	it("shows nothing for anything else", () => {
		assert.equal(summarise({ kind: "current" }, ".pi"), undefined);
		assert.equal(summarise({ kind: "unknown", reason: "offline" }, ".pi"), undefined);
	});
});

describe("clearing", () => {
	/**
	 * setStatus takes undefined to mean "remove this". summarise returns
	 * undefined for everything that is not "behind", and the caller passes it
	 * through rather than skipping the call -- pulling mid-session used to
	 * leave the reminder up until the next start, telling you to do something
	 * already done.
	 */
	it("returns undefined rather than an empty string", () => {
		// An empty string is a widget of one blank line; undefined removes it.
		assert.equal(summarise({ kind: "current" }, ".pi"), undefined);
		assert.equal(summarise({ kind: "unknown", reason: "offline" }, ".pi"), undefined);
	});

	it("reaches setWidget even when there is nothing to say", () => {
		const source = readFileSync(join(import.meta.dirname, "index.ts"), "utf-8");
		assert.match(source, /setWidget\(KEY, text === undefined \? undefined :/, "undefined must reach setWidget, since that is what removes it");
	});
});
