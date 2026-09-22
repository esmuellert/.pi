import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { VERSION, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
	RESTART_POLL_INTERVAL_MS,
	buildRestartArgs,
	isPiVersionChanged,
	parsePiVersion,
} from "./restart.ts";

const STATUS_KEY = "auto-upgrade";
const HANDOFF_PATH = fileURLToPath(new URL("./handoff.mjs", import.meta.url));
const HANDOFF_START_TIMEOUT_MS = 2_000;

type TaskWatcherState = { running?: number; pendingNotifications?: number };
type RestartContext = ExtensionContext & {
	ui: ExtensionContext["ui"] & { getEditorText?: () => string };
};

export default function autoUpgrade(pi: ExtensionAPI): void {
	let sessionContext: RestartContext | undefined;
	let sessionFile: string | undefined;
	let shuttingDown = false;
	let restartStarted = false;
	let pendingVersion: string | undefined;
	let pendingPoll: NodeJS.Timeout | undefined;
	let pendingNoticeShown = false;
	let taskWatcherAvailable = false;
	let runningWatchedTasks = 0;
	let pendingTaskNotifications = 0;
	function clearPendingPoll(): void {
		if (pendingPoll) clearInterval(pendingPoll);
		pendingPoll = undefined;
	}

	function setPendingStatus(ctx: RestartContext, version: string): void {
		pendingVersion = version;
		ctx.ui.setStatus(STATUS_KEY, `Pi ${VERSION} → ${version}; restart pending`);
		if (!pendingNoticeShown) {
			pendingNoticeShown = true;
			ctx.ui.notify(
				`Pi ${version} is installed. Restart is waiting for an empty editor and no active watched tasks or pending task notifications.`,
				"warning",
			);
		}
	}

	function isSafeToRestart(ctx: RestartContext): boolean {
		if (!ctx.isIdle() || ctx.hasPendingMessages()) return false;
		if ((ctx.ui.getEditorText?.() ?? "").length > 0) return false;
		if (taskWatcherAvailable && (runningWatchedTasks > 0 || pendingTaskNotifications > 0)) return false;
		return true;
	}

	async function startHandoff(ctx: RestartContext, installedVersion: string): Promise<void> {
		if (restartStarted || shuttingDown) return;
		if (!isSafeToRestart(ctx)) {
			setPendingStatus(ctx, installedVersion);
			if (!pendingPoll) {
				pendingPoll = setInterval(() => {
					const current = sessionContext;
					if (!current || !pendingVersion || shuttingDown) {
						clearPendingPoll();
						return;
					}
					if (isSafeToRestart(current)) void startHandoff(current, pendingVersion);
				}, RESTART_POLL_INTERVAL_MS);
			}
			return;
		}

		const currentSessionFile = ctx.sessionManager.getSessionFile() ?? sessionFile;
		if (!currentSessionFile) {
			ctx.ui.notify("Pi was upgraded, but this session has no file to resume; restart was skipped.", "warning");
			ctx.ui.setStatus(STATUS_KEY, undefined);
			pendingVersion = undefined;
			return;
		}

		restartStarted = true;
		clearPendingPoll();
		ctx.ui.setStatus(STATUS_KEY, `Restarting Pi ${installedVersion}…`);

		const args = buildRestartArgs(process.argv.slice(2), currentSessionFile);
		const command = process.platform === "win32" ? "pi.cmd" : "pi";
		const helper = spawn(
			process.execPath,
			[
				HANDOFF_PATH,
				JSON.stringify({
					parentPid: process.pid,
					command,
					args,
					cwd: ctx.cwd,
				}),
			],
			{
				cwd: ctx.cwd,
				detached: true,
				stdio: "inherit",
				env: { ...process.env, PI_AUTO_UPGRADE: "1" },
			},
		);

		const started = await new Promise<boolean>((resolve) => {
			const timeout = setTimeout(() => resolve(false), HANDOFF_START_TIMEOUT_MS);
			helper.once("spawn", () => {
				clearTimeout(timeout);
				resolve(true);
			});
			helper.once("error", () => {
				clearTimeout(timeout);
				resolve(false);
			});
		});

		if (!started) {
			restartStarted = false;
			ctx.ui.setStatus(STATUS_KEY, undefined);
			ctx.ui.notify("Pi was upgraded, but the replacement process could not be started.", "error");
			return;
		}

		pendingVersion = undefined;
		pendingNoticeShown = false;
		ctx.shutdown();
	}

	async function checkForUpgrade(ctx: RestartContext): Promise<void> {
		if (ctx.mode !== "tui" || !ctx.isIdle() || restartStarted || shuttingDown) return;

		const result = await pi.exec(process.platform === "win32" ? "pi.cmd" : "pi", ["--version"], {
			timeout: 5_000,
		});
		if (result.code !== 0) return;

		const installedVersion = parsePiVersion(result.stdout);
		if (!isPiVersionChanged(VERSION, installedVersion)) return;
		await startHandoff(ctx, installedVersion!);
	}

	pi.events.on("task-watcher:available", () => {
		taskWatcherAvailable = true;
	});
	pi.events.on("task-watcher:state", (data: unknown) => {
		taskWatcherAvailable = true;
		const state = data as TaskWatcherState | undefined;
		runningWatchedTasks = typeof state?.running === "number" ? state.running : 0;
		pendingTaskNotifications = typeof state?.pendingNotifications === "number" ? state.pendingNotifications : 0;
	});

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		const typedContext = ctx as RestartContext;
		sessionContext = typedContext;
		sessionFile = ctx.sessionManager.getSessionFile();
		shuttingDown = false;
		restartStarted = false;
		pendingVersion = undefined;
		pendingNoticeShown = false;
		clearPendingPoll();
	});

	pi.on("session_shutdown", () => {
		shuttingDown = true;
		clearPendingPoll();
		sessionContext = undefined;
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		void checkForUpgrade(ctx as RestartContext);
	});
}

export { buildRestartArgs, isPiVersionChanged, parsePiVersion } from "./restart.ts";
