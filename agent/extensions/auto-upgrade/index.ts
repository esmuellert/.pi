import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { VERSION, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
	RESTART_POLL_INTERVAL_MS,
	buildRestartArgs,
	isPiVersionChanged,
	parsePiVersion,
	detectLoadedPiVersion,
	resolveExecutable,
} from "./restart.ts";

const STATUS_KEY = "auto-upgrade";
const HANDOFF_PATH = fileURLToPath(new URL("./handoff.mjs", import.meta.url));
const HANDOFF_START_TIMEOUT_MS = 2_000;
const LOADED_VERSION = detectLoadedPiVersion(process.argv[1], VERSION);

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
		ctx.ui.setStatus(STATUS_KEY, `Pi ${LOADED_VERSION} → ${version}; restart pending`);
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
		const restartCwd = ctx.cwd;
		const command = process.platform === "win32" ? "pi.cmd" : "pi";
		const restartEnvironment = { ...process.env, PI_AUTO_UPGRADE: "1" };
		const executable = process.platform === "win32" ? undefined : resolveExecutable(command, restartEnvironment);
		if (executable && typeof process.execve === "function") {
			process.once("exit", () => {
				try {
					process.chdir(restartCwd);
					process.execve!(executable, [executable, ...args], restartEnvironment);
				} catch (error) {
					console.error(`auto-upgrade: could not replace Pi: ${String(error)}`);
				}
			});
			pendingVersion = undefined;
			pendingNoticeShown = false;
			ctx.shutdown();
			return;
		}

		const helper = spawn(
			process.execPath,
			[
				HANDOFF_PATH,
				JSON.stringify({
					parentPid: process.pid,
					command,
					args,
					cwd: restartCwd,
				}),
			],
			{
				cwd: restartCwd,
				detached: process.platform === "win32",
				stdio: "inherit",
				env: restartEnvironment,
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
		if (process.platform === "win32") {
			const originalExit = process.exit;
			let shutdownExitCode = 0;
			process.exit = ((code?: number | string | null) => {
				if (typeof code === "number") shutdownExitCode = code;
			}) as typeof process.exit;
			ctx.shutdown();
			const replacementExitCode = await new Promise<number>((resolve) => {
				helper.once("error", () => resolve(1));
				helper.once("exit", (code, signal) => resolve(signal ? 1 : code ?? shutdownExitCode));
			});
			process.exit = originalExit;
			originalExit(replacementExitCode);
			return;
		}
		ctx.shutdown();
	}

	async function checkForUpgrade(ctx: RestartContext): Promise<void> {
		if (ctx.mode !== "tui" || !ctx.isIdle() || restartStarted || shuttingDown) return;

		const versionProbe = process.platform === "win32"
			? { command: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", "call pi.cmd --version"] }
			: { command: "pi", args: ["--version"] };
		const result = await pi.exec(versionProbe.command, versionProbe.args, {
			timeout: 5_000,
		});
		if (result.code !== 0) return;

		const installedVersion = parsePiVersion(result.stdout);
		if (!isPiVersionChanged(LOADED_VERSION, installedVersion)) return;
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

export { buildRestartArgs, detectLoadedPiVersion, isPiVersionChanged, parsePiVersion } from "./restart.ts";
