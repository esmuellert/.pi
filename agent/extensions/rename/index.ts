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
 * about to send, after compaction has replaced the older ones with a summary.
 * That is a fifth the size of the session file and is what the session actually
 * is at this point. Before the first request there is no context and no name is
 * offered: a session nobody has spoken in has nothing to be named after.
 */

import type { ExtensionAPI, ModelRegistry } from "@earendil-works/pi-coding-agent";

import { type ContextMessage, nameFor } from "./name.ts";

/** Store the name and say what it ended up as, pi having its own opinion. */
function settle(ctx: { ui: { notify(message: string, type?: "info" | "warning" | "error"): void } }, pi: ExtensionAPI, name: string): void {
	pi.setSessionName(name);
	ctx.ui.notify(`Session name: ${pi.getSessionName() ?? name}`);
}

export default function (pi: ExtensionAPI) {
	let registry: ModelRegistry | undefined;
	let context: readonly ContextMessage[] = [];

	pi.on("session_start", (_event, ctx) => {
		registry = ctx.modelRegistry;
	});

	// Held rather than read on demand: `context` fires as a request is being
	// built, and a command runs when none is.
	pi.on("context", (event) => {
		context = (event.messages ?? []) as readonly ContextMessage[];
	});

	pi.registerCommand("rename", {
		description: "Name this session, or have a name written for it",
		async handler(args, ctx) {
			const given = args.trim();
			if (given) return settle(ctx, pi, given);

			if (context.length === 0) {
				ctx.ui.notify("Nothing said yet — /rename <name> to set one", "warning");
				return;
			}

			ctx.ui.setWorkingMessage("Naming this session");
			try {
				const name = await nameFor(registry, context);
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
