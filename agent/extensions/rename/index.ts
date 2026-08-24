/**
 * /rename — set the session's name, or have one written.
 *
 * pi has `/name <name>`, handled inline before extension commands are looked
 * up, so this cannot reuse that word. What pi has no version of is the empty
 * call: 71 sessions on this machine, none named, because naming one is a thing
 * you have to stop and do.
 *
 *   /rename <name>    set it
 *   /rename           ask a model, using the conversation as it stands
 *
 * The conversation is taken from the `context` event -- the messages pi is
 * about to send, after compaction has replaced the older ones with a summary --
 * or from the session file when no request has been built yet.
 * That is a fifth the size of the session file and is what the session actually
 * is at this point. A session nobody has spoken in has nothing to be named
 * after, and none is offered.
 */

import type { ExtensionAPI, ModelRegistry } from "@earendil-works/pi-coding-agent";

import { type Branch, type ContextMessage, fromBranch, nameFor } from "./name.ts";

/** Store the name and say what it ended up as, pi having its own opinion. */
function settle(ctx: { ui: { notify(message: string, type?: "info" | "warning" | "error"): void } }, pi: ExtensionAPI, name: string): void {
	pi.setSessionName(name);
	ctx.ui.notify(`Session name: ${pi.getSessionName() ?? name}`);
}

export default function (pi: ExtensionAPI) {
	let registry: ModelRegistry | undefined;
	let branch: Branch | undefined;
	let context: readonly ContextMessage[] = [];

	pi.on("session_start", (_event, ctx) => {
		registry = ctx.modelRegistry;
		branch = ctx.sessionManager as unknown as Branch;
	});

	// Held rather than read on demand: `context` fires as a request is being
	// built, and a command runs when none is.
	pi.on("context", (event) => {
		context = (event.messages ?? []) as readonly ContextMessage[];
	});

	/**
	 * The conversation to name, live if there is one and stored otherwise.
	 *
	 * `context` fires only while a request is being built, so a session opened
	 * with `/resume` and renamed before anything is sent has never seen the
	 * event -- and reported having nothing said in it while holding hundreds of
	 * turns. The session file is what "has anything been said" actually means.
	 */
	const conversation = (): readonly ContextMessage[] =>
		context.length > 0 ? context : fromBranch(branch);

	pi.registerCommand("rename", {
		description: "Name this session, or have a name written for it",
		async handler(args, ctx) {
			const given = args.trim();
			if (given) return settle(ctx, pi, given);

			const messages = conversation();
			if (messages.length === 0) {
				ctx.ui.notify("Nothing said yet — /rename <name> to set one", "warning");
				return;
			}

			ctx.ui.setWorkingMessage("Naming this session");
			try {
				const name = await nameFor(registry, messages);
				if (!name) {
					ctx.ui.notify("No name came back — /rename <name> to set one", "warning");
					return;
				}
				settle(ctx, pi, name);
			} catch (error) {
				ctx.ui.notify(`Could not name it: ${error instanceof Error ? error.message : String(error)}`, "error");
			} finally {
				ctx.ui.setWorkingMessage(undefined);
			}
		},
	});
}
