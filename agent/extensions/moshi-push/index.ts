/**
 * Ring the phone when a pi turn finishes.
 *
 * moshi-hook already tells Moshi that the turn ended; what it sends is a
 * `task_complete`, which by Moshi's design updates the Live Activity and never
 * raises a banner. A Live Activity is something you look at — this is for the
 * case where the phone is in a pocket and nobody is looking at anything. See
 * event.ts for why that takes two events and what `error` is doing here.
 *
 * Absent Moshi this file registers nothing: no handlers, no command, no timers,
 * no network. The test is Moshi's own pairing file, so "installed" means paired
 * rather than merely downloaded.
 *
 * Credentials are the host secret written by `moshi-hook pair`, which is only
 * on disk when the secret store is `file`. On a Keychain-backed install this
 * stays off rather than prompting for Keychain access on every pi start.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	buildEvents,
	type Config,
	type Credentials,
	DEFAULT_CONFIG,
	eventsUrl,
	lastAssistantText,
	parseConfig,
	parseCredentials,
	shouldNotify,
	terminalFromEnv,
	type Turn,
} from "./event.ts";

const SECRETS_PATH = join(homedir(), ".config", "moshi", "secrets.json");
const CONFIG_PATH = join(
	process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
	"moshi-push.json",
);
const REQUEST_TIMEOUT_MS = 10_000;

function readJson(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
}

/** Read per send, so a rotated secret or an edited setting needs no restart. */
function credentials(): Credentials | undefined {
	return parseCredentials(readJson(SECRETS_PATH));
}

function config(): Config {
	return existsSync(CONFIG_PATH) ? parseConfig(readJson(CONFIG_PATH)) : { ...DEFAULT_CONFIG };
}

/**
 * macOS console lock state, or undefined when it cannot be read.
 *
 * Only consulted when `onlyWhenLocked` is on, so the process never runs for
 * someone who did not ask for it.
 */
function consoleLocked(): Promise<boolean | undefined> {
	if (process.platform !== "darwin") return Promise.resolve(undefined);
	return new Promise((resolve) => {
		execFile(
			"/usr/sbin/ioreg",
			["-n", "Root", "-d1", "-k", "CGSSessionScreenIsLocked"],
			{ timeout: 1500 },
			(error, stdout) => {
				if (error) return resolve(undefined);
				const match = /"CGSSessionScreenIsLocked"\s*=\s*(Yes|No|true|false|1|0)/i.exec(stdout);
				// The key is absent while unlocked, which is an answer, not a failure.
				if (!match) return resolve(false);
				resolve(/^(yes|true|1)$/i.test(match[1] ?? ""));
			},
		);
	});
}

async function post(event: unknown, creds: Credentials): Promise<void> {
	const response = await fetch(eventsUrl(creds.hostId), {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${creds.hostSecret}`,
			// Cloudflare fronts this API and answers 403 to some default agents,
			// which would look like a silent delivery failure. Ask by name.
			"user-agent": "pi-moshi-push",
		},
		body: JSON.stringify(event),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new Error(`HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
	}
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Send the ring, then the correction. If the ring fails there is nothing to
 * correct, so the second event is skipped rather than left to contradict it.
 */
async function publish(events: unknown[], creds: Credentials, gapMs: number): Promise<void> {
	const [ring, settle] = events;
	if (ring === undefined) return;
	await post(ring, creds);
	if (settle === undefined) return;
	await delay(gapMs);
	await post(settle, creds);
}

function contextRemaining(ctx: ExtensionContext): number | undefined {
	const percent = ctx.getContextUsage()?.percent;
	if (typeof percent !== "number" || !Number.isFinite(percent)) return undefined;
	return 100 - percent;
}

function turnFrom(ctx: ExtensionContext, sessionId: string, summary: string, durationMs: number): Turn {
	const turn: Turn = {
		sessionId,
		project: basename(ctx.cwd || process.cwd()) || "pi",
		summary,
		durationMs,
		now: Date.now(),
	};
	const model = ctx.model?.id ?? process.env.PI_MODEL;
	if (model) turn.model = model;
	const remaining = contextRemaining(ctx);
	if (remaining !== undefined) turn.contextRemaining = remaining;
	const terminal = terminalFromEnv(process.env);
	if (terminal) turn.terminal = terminal;
	return turn;
}

export default function (pi: ExtensionAPI) {
	// No pairing, no extension. Everything below this line stays unregistered.
	if (!existsSync(SECRETS_PATH)) return;

	let rootSession = false;
	let sessionEnabled = true;
	let turnStartedAt = 0;
	let closingWords = "";
	let lastError = "";

	pi.on("session_start", (_event, ctx) => {
		// TUI only: print, json and rpc runs are automation, and nobody is
		// waiting on a phone for those.
		rootSession = ctx.mode === "tui";
	});

	pi.on("agent_start", () => {
		if (!turnStartedAt) turnStartedAt = Date.now();
	});

	pi.on("agent_end", (event) => {
		// A run can end and resume (retry, compaction, queued follow-up), so keep
		// the latest words rather than the ones from the run that settles.
		const text = lastAssistantText(event.messages);
		if (text) closingWords = text;
	});

	pi.on("agent_settled", (_event, ctx) => {
		const durationMs = turnStartedAt ? Date.now() - turnStartedAt : 0;
		const summary = closingWords;
		turnStartedAt = 0;
		closingWords = "";

		if (!rootSession || !sessionEnabled) return;
		// Another extension may have started a new run; that one is not finished.
		if (!ctx.isIdle()) return;

		const sessionId = ctx.sessionManager.getSessionId();
		if (!sessionId) return;

		const creds = credentials();
		if (!creds) return;
		const settings = config();
		const turn = turnFrom(ctx, sessionId, summary, durationMs);

		// Detached on purpose: a notification must never delay or fail a turn.
		void (async () => {
			try {
				if (!shouldNotify(turn, settings, settings.onlyWhenLocked ? await consoleLocked() : undefined)) return;
				await publish(buildEvents(turn, settings), creds, settings.fixDelayMs);
				lastError = "";
			} catch (error) {
				lastError = error instanceof Error ? error.message : String(error);
				if (ctx.hasUI) ctx.ui.notify(`moshi-push: ${lastError}`, "warning");
			}
		})();
	});

	pi.registerCommand("moshi-push", {
		description: "Moshi completion pushes: status | test | on | off",
		getArgumentCompletions: (prefix: string) => {
			const items = ["status", "test", "on", "off"]
				.filter((value) => value.startsWith(prefix))
				.map((value) => ({ value, label: value }));
			return items.length > 0 ? items : null;
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const action = args.trim().toLowerCase() || "status";
			const settings = config();

			if (action === "on" || action === "off") {
				sessionEnabled = action === "on";
				ctx.ui.notify(`moshi-push ${sessionEnabled ? "on" : "off"} for this session`, "info");
				return;
			}

			if (action === "test") {
				const creds = credentials();
				if (!creds) {
					ctx.ui.notify(`No host secret in ${SECRETS_PATH}`, "error");
					return;
				}
				const turn = turnFrom(
					ctx,
					ctx.sessionManager.getSessionId() || "moshi-push-test",
					"Test notification from moshi-push",
					0,
				);
				try {
					await publish(buildEvents(turn, settings), creds, settings.fixDelayMs);
					ctx.ui.notify("moshi-push: sent", "info");
				} catch (error) {
					ctx.ui.notify(`moshi-push: ${error instanceof Error ? error.message : String(error)}`, "error");
				}
				return;
			}

			const terminal = terminalFromEnv(process.env);
			ctx.ui.notify(
				[
					`enabled        ${settings.enabled && sessionEnabled ? "yes" : "no"}`,
					`paired         ${credentials() ? "yes" : "no"}`,
					`min seconds    ${settings.minSeconds}`,
					`only locked    ${settings.onlyWhenLocked}`,
					`fix status     ${settings.fixStatus} (${settings.fixDelayMs}ms)`,
					`opens          ${terminal ? Object.values(terminal).filter(Boolean).join(" ") : "no terminal detected"}`,
					`last error     ${lastError || "none"}`,
					`settings       ${CONFIG_PATH}`,
				].join("\n"),
				"info",
			);
		},
	});
}
