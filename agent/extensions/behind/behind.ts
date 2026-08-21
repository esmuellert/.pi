/**
 * How far a checkout is behind its remote.
 *
 * Kept apart from the wiring so it can be tested without a session.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** What was found, or why nothing was. */
export type State =
	| { kind: "behind"; commits: number; branch: string }
	| { kind: "current" }
	| { kind: "unknown"; reason: string };

/**
 * Ask the remote what it has, and count what is missing here.
 *
 * `fetch` rather than `ls-remote`, though ls-remote was tried first. Counting
 * how far behind a checkout is needs both ends present, and being behind is
 * exactly the case where the remote's commits are not here yet -- ls-remote
 * returns a hash git cannot then count to. fetch brings the objects.
 *
 * It writes only into .git: no file in the working tree changes and HEAD does
 * not move, verified against a checkout reset two commits back.
 *
 * Everything that can go wrong -- no network, no remote, a detached head, a
 * branch the remote has never seen -- comes back as `unknown` with a reason.
 * A reminder that cannot be trusted is worse than no reminder.
 */
export async function behind(cwd: string, timeoutMs = 5000): Promise<State> {
	const git = async (...args: string[]) => (await run("git", args, { cwd, timeout: timeoutMs })).stdout.trim();

	let branch: string;
	try {
		branch = await git("rev-parse", "--abbrev-ref", "HEAD");
	} catch {
		return { kind: "unknown", reason: "not a git checkout" };
	}
	if (branch === "HEAD") return { kind: "unknown", reason: "detached head" };

	try {
		await git("fetch", "--quiet", "origin", branch);
	} catch (error) {
		return { kind: "unknown", reason: error instanceof Error ? error.message.split("\n")[0]! : "fetch failed" };
	}

	const count = Number(await git("rev-list", "--count", "HEAD..FETCH_HEAD"));
	if (!Number.isFinite(count)) return { kind: "unknown", reason: "could not count" };
	return count > 0 ? { kind: "behind", commits: count, branch } : { kind: "current" };
}

/** What to show in the footer, or nothing when there is nothing to say. */
export function summarise(state: State, name: string): string | undefined {
	if (state.kind !== "behind") return undefined;
	return `${name} behind ${state.commits}`;
}
