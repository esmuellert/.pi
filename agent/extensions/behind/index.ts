/**
 * Say when the config repository has commits that are not here yet.
 *
 * ~/.pi is what pi runs from. Being behind means running an older version of
 * your own setup, and nothing else says so -- git only complains when you ask.
 *
 * The check talks to the network, so it is not awaited. session_start returns
 * immediately and the answer arrives in the footer a moment later; setStatus
 * writes to the footer's data provider and requests a render, so it works at
 * any time rather than only during the handler.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";

import { behind, summarise } from "./behind.ts";

const KEY = "behind";

/** The repository pi runs from, which is the one worth watching. */
function configRepo(): string {
	const agent = process.env.PI_CODING_AGENT_DIR;
	// PI_CODING_AGENT_DIR points at the agent directory; the repository is its
	// parent. Without it, the default layout is ~/.pi/agent.
	return agent ? join(agent, "..") : join(homedir(), ".pi");
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		if (ctx.mode !== "tui") return;
		// Deliberately not awaited: a network round trip is ~200ms and would be
		// paid on every start, for something nobody is waiting to read.
		void behind(configRepo())
			.then((state) => {
				const text = summarise(state, ".pi");
				if (text) ctx.ui.setStatus(KEY, text);
			})
			.catch(() => {
				// A check that cannot run says nothing. There is no version of
				// this worth interrupting a session for.
			});
	});
}
