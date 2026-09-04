/**
 * /cd — move the session to another directory.
 *
 * pi binds a session to the directory it was created in: the cwd lives in the
 * session header and tools read it from there, not from process.cwd(). So
 * `--session` drags you back to the original directory, only `--fork` adopts a
 * new one, there is no in-process chdir, and neither ctx.fork() nor
 * ctx.switchSession() takes a cwd.
 *
 * This copies the session into the target directory's store and switches to it
 * — the same effect as `cd <dir> && pi --fork`, without leaving the TUI.
 *
 * pi's own SessionManager computes the destination (session directory encoding,
 * file naming, id generation), so those formats are not reimplemented here. The
 * header is the one shape we still write ourselves, built from pi's exported
 * CURRENT_SESSION_VERSION and typed as its exported SessionHeader, because pi
 * defers creating the file until a session has an assistant message.
 *
 * The original session is left untouched, and its path is printed: delete it
 * once you are satisfied the move worked.
 */

import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { CURRENT_SESSION_VERSION, type ExtensionAPI, SessionManager } from "@earendil-works/pi-coding-agent";
import { relocateSession, resolveTarget, type SessionSlotFactory } from "./relocate.ts";


/**
 * Ask pi where a new session for `cwd` belongs. Never writes anything.
 *
 * No parentSession is passed: pi assigns the same directory, cwd and a fresh id
 * either way, so it would only end up in the header, where the iOS client
 * cannot cope with it. contract.test.ts holds pi to that.
 */
export const piSessionSlot: SessionSlotFactory = (cwd) => {
	const sm = SessionManager.create(cwd);
	const file = sm.getSessionFile();
	if (!file) throw new Error("pi did not assign a session file");
	return { file, id: sm.getSessionId(), cwd: sm.getCwd() };
};


export default function (pi: ExtensionAPI) {
	pi.registerCommand("cd", {
		description: "Move this session to another directory (copies, then switches)",
		handler: async (args, ctx) => {
			const target = resolveTarget(args ?? "", ctx.cwd);
			if ("error" in target) {
				ctx.ui.notify(target.error, "error");
				return;
			}
			if (target.path === resolve(ctx.cwd)) {
				ctx.ui.notify(`Already in ${target.path}`, "info");
				return;
			}

			const source = ctx.sessionManager.getSessionFile();
			if (!source) {
				ctx.ui.notify("Ephemeral session (--no-session) cannot be moved", "error");
				return;
			}

			let moved: string;
			try {
				moved = relocateSession(source, target.path, piSessionSlot, CURRENT_SESSION_VERSION);
			} catch (err) {
				ctx.ui.notify(`Could not move session: ${err instanceof Error ? err.message : String(err)}`, "error");
				return;
			}

			const result = await ctx.switchSession(moved, {
				withSession: async (next) => {
					next.ui.notify(`Now in ${target.path}`, "info");
					// The original is kept, and its path said rather than remembered.
					// /cd-prune held the list in the extension's closure, which meant it
					// worked until pi exited and then the file could never be found
					// again. A path on screen outlives the process, and deleting one is
					// a line of shell.
					next.ui.notify(`Original left at ${source}`, "info");
				},
			});

			if (result.cancelled) {
				// Nothing switched, so the copy is litter rather than history.
				rmSync(moved, { force: true });
				ctx.ui.notify("Move cancelled", "warning");
			}
		},
	});
}
