/**
 * How far one wheel event scrolls the fullscreen transcript.
 *
 * The mouse protocol reports one event per wheel notch and says nothing about
 * what a notch should mean; deciding that is the application's job. pi decides
 * one line, which is why scrolling a seventy-row screen in `--tui-mode
 * fullscreen` moves it by a seventieth per notch.
 *
 * Terminals that scroll their own scrollback pick a larger number for the same
 * gesture: xterm's default binding is `scroll-back(5,line,m)`, Windows uses 3
 * system-wide, Ghostty's discrete default is 3, kitty's is 5. Three matches
 * both this machine's OS default and what testing here felt right.
 *
 * ---
 *
 * Two terminals already do the multiplying themselves and send several reports
 * for one notch -- Ghostty sends three, kitty five. On those, pi's one line per
 * report is already correct and this extension would triple it. Both also send
 * many reports for a trackpad swipe, since a trackpad expresses speed through
 * event count, so a multiplier makes a swipe fly.
 *
 * There is no way to tell from the protocol which kind of terminal or which
 * kind of device is on the other end. So this is a setting, not a detection,
 * and it is wrong to keep it after moving to a terminal that multiplies.
 *
 * Check with: node /tmp/probe-wheel.mjs -- if one notch already reports more
 * than once, remove this.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Lines per wheel report. The one number this extension exists to set. */
const LINES_PER_NOTCH = 3;

/** The field on pi's fullscreen TUI. Private to pi, so it may be renamed. */
const FIELD = "wheelScrollLines";

const KEY = "wheel-step";

type Tui = { mode?: string } & Record<string, unknown>;

/** What happened, so a failure is reported rather than silently doing nothing. */
export type Outcome =
	| { applied: true; from: number; to: number }
	| { applied: false; reason: "not-fullscreen" }
	| { applied: false; reason: "field-missing" };

export function applyTo(tui: Tui, lines: number): Outcome {
	// Regular mode leaves scrolling to the terminal, which already has its own
	// step. Only the fullscreen TUI reads this.
	if (tui.mode !== "fullscreen") return { applied: false, reason: "not-fullscreen" };
	const before = tui[FIELD];
	if (typeof before !== "number") return { applied: false, reason: "field-missing" };
	tui[FIELD] = lines;
	return { applied: true, from: before, to: lines };
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		if (ctx.mode !== "tui") return;

		// A widget factory is the only place an extension is handed the TUI
		// itself. Nothing is drawn: the widget exists to receive that argument
		// and is removed as soon as it has.
		let outcome: Outcome = { applied: false, reason: "field-missing" };
		ctx.ui.setWidget(KEY, (tui) => {
			// TUI's public type does not admit the private field, which is the
			// point: this reaches past it deliberately, and applyTo checks.
			outcome = applyTo(tui as unknown as Tui, LINES_PER_NOTCH);
			return { render: () => [], invalidate() {} };
		});
		ctx.ui.setWidget(KEY, undefined);

		// Version drift is worth hearing about. A missing field means pi renamed
		// it and the wheel is quietly back to one line per notch.
		if (!outcome.applied && outcome.reason === "field-missing") {
			ctx.ui.notify(`wheel: pi has no ${FIELD}; scrolling stays at one line per notch`, "warning");
		}
	});
}
