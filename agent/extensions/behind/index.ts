/**
 * Say when the config repository has commits that are not here yet.
 *
 * ~/.pi is what pi runs from. Being behind means running an older version of
 * your own setup, and nothing else says so -- git only complains when you ask.
 *
 * It is shown above the editor rather than in the footer. The footer is where
 * the numbers that are always true live -- context, cost, model -- and a line
 * that appears only when something needs doing does not belong among them.
 *
 * The check talks to the network, so it is not awaited. session_start returns
 * immediately and the line arrives a moment later; setWidget writes to the
 * container and requests a render, so it works at any time rather than only
 * during the handler.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { join } from "node:path";

import { behind, summarise } from "./behind.ts";

const KEY = "behind";

/**
 * How long an answer is trusted before asking again.
 *
 * The check is only worth repeating because a pull during a session leaves the
 * reminder stale, and a session runs for hundreds of turns -- 346 in the one
 * this was written in. Once every few minutes catches a pull without turning
 * a conversation into a stream of network requests.
 */
const REFRESH_MS = 5 * 60 * 1000;

/** The repository pi runs from, which is the one worth watching. */
function configRepo(): string {
	const agent = process.env.PI_CODING_AGENT_DIR;
	// PI_CODING_AGENT_DIR points at the agent directory; the repository is its
	// parent. Without it, the default layout is ~/.pi/agent.
	return agent ? join(agent, "..") : join(homedir(), ".pi");
}

export default function (pi: ExtensionAPI) {
	let lastChecked = 0;
	let checking = false;

	/**
	 * Look, and say what was found -- including that there is nothing to say.
	 *
	 * Clearing matters as much as setting. Pulling mid-session used to leave the
	 * reminder up until the next start, telling you to do something already done.
	 */
	const check = (ctx: ExtensionContext) => {
		if (checking || Date.now() - lastChecked < REFRESH_MS) return;
		checking = true;
		// Deliberately not awaited: a network round trip is ~200ms and nobody is
		// waiting to read the answer.
		void behind(configRepo())
			.then((state) => {
				lastChecked = Date.now();
				const text = summarise(state, ".pi");
				// undefined removes the widget, which is how the line clears
				// itself once the pull has happened.
				if (text === undefined) {
					ctx.ui.setWidget(KEY, undefined);
					return;
				}
				// A factory rather than an array of lines, because only a
				// component is told the width, and right alignment is a
				// question about the width.
				ctx.ui.setWidget(KEY, (_tui, theme) => ({
					render(width: number): string[] {
						const painted = theme.fg("muted", text);
						const room = width - visibleWidth(painted);
						return [room > 0 ? " ".repeat(room) + painted : painted];
					},
					invalidate() {},
				}));
			})
			.catch(() => {
				// A check that cannot run says nothing. There is no version of
				// this worth interrupting a session for.
			})
			.finally(() => {
				checking = false;
			});
	};

	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		if (ctx.mode !== "tui") return;
		check(ctx);
	});

	// A pull during a session makes the reminder wrong, so it is looked at
	// again as turns go by -- at most once every REFRESH_MS.
	pi.on("turn_end", async (_event, ctx: ExtensionContext) => {
		if (ctx.mode !== "tui") return;
		check(ctx);
	});
}
