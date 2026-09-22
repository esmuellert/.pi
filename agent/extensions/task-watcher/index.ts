import { resolve } from "node:path";
import { DynamicBorder, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Box, Container, Text, type Component, type TUI } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import { TaskArchive, type ArchivedTask } from "./archive.ts";
import { elapsed, TaskRegistry, taskStateGlyph, type WatchedTask } from "./task.ts";

const WIDGET_KEY = "task-watcher";
const COMPLETION_NOTIFICATION_GRACE_MS = 2_000;
type WatchView = "all" | "archive" | string;

export default function taskWatcher(pi: ExtensionAPI): void {
	let ui: ExtensionContext["ui"] | undefined;
	let sessionContext: ExtensionContext | undefined;
	let statusTui: TUI | undefined;
	let shuttingDown = false;
	let cleanupTimer: NodeJS.Timeout | undefined;
	const completionNotifications = new Map<string, NodeJS.Timeout>();
	const archive = new TaskArchive();
	let lastPublishedRunning = -1;
	let lastPublishedNotifications = -1;
	function publishTaskWatcherState(force = false): void {
		const running = registry.active().length;
		const pendingNotifications = completionNotifications.size;
		if (!force && running === lastPublishedRunning && pendingNotifications === lastPublishedNotifications) return;
		lastPublishedRunning = running;
		lastPublishedNotifications = pendingNotifications;
		pi.events.emit("task-watcher:state", { running, pendingNotifications });
	}
	const registry = new TaskRegistry({
		onChange: () => {
			statusTui?.requestRender();
			publishTaskWatcherState();
		},
		onFinish: (task, hadWaiter) => {
			if (!shuttingDown && !hadWaiter && task.state !== "cancelled" && task.state !== "orphaned") scheduleNotification(task);
		},
		onArchive: (tasks) => void archive.appendMany(tasks),
	});
	pi.events.emit("task-watcher:available", {});

	function scheduleNotification(task: WatchedTask): void {
		const timer = setTimeout(() => {
			completionNotifications.delete(task.id);
			publishTaskWatcherState();
			if (sessionContext && !sessionContext.isIdle()) return;
			notifyAgent(task);
		}, COMPLETION_NOTIFICATION_GRACE_MS);
		completionNotifications.set(task.id, timer);
		publishTaskWatcherState();
	}

	function suppressNotification(taskId: string): void {
		const timer = completionNotifications.get(taskId);
		if (!timer) return;
		clearTimeout(timer);
		completionNotifications.delete(taskId);
		publishTaskWatcherState();
	}

	function notifyAgent(task: WatchedTask): void {
		const message = [
			`[task-watcher] Watched task ${task.id} (${task.label}) finished with state: ${task.state}.`,
			task.exitCode === undefined ? "" : `Exit code: ${task.exitCode ?? "signal"}.`,
			task.latestMessage ? `Latest output: ${task.latestMessage}` : "",
			"Continue from this task result if further work is needed.",
		].filter(Boolean).join(" ");
		try {
			pi.sendUserMessage(message, { deliverAs: "followUp" });
		} catch {
			// The session may be shutting down while a child process exits.
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		shuttingDown = false;
		sessionContext = ctx;
		ui = ctx.ui;
		await archive.list();
		pi.events.emit("task-watcher:available", {});
		publishTaskWatcherState(true);
		cleanupTimer = setInterval(() => registry.sweepExpired(), 60_000);
		ui.setWidget(
			WIDGET_KEY,
			(tui, theme) => {
				statusTui = tui;
				return new TaskStatusWidget(registry, tui, theme);
			},
			{ placement: "aboveEditor" },
		);
	});

	pi.on("session_shutdown", async () => {
		shuttingDown = true;
		if (cleanupTimer) clearInterval(cleanupTimer);
		cleanupTimer = undefined;
		for (const timer of completionNotifications.values()) clearTimeout(timer);
		completionNotifications.clear();
		await registry.cancelAll();
		await archive.appendMany(registry.removeFinished());
		ui?.setWidget(WIDGET_KEY, undefined);
		statusTui = undefined;
		sessionContext = undefined;
		ui = undefined;
	});

	pi.registerTool({
		name: "start_watched_task",
		label: "Start watched task",
		description: "Start a long-running independent shell task asynchronously. Returns immediately with a task ID. Use get_watched_task or wait_watched_task for its result; the user can observe it with /watch.",
		promptSnippet: "Start an independent long-running task without blocking the agent",
		promptGuidelines: [
			"Use start_watched_task only for independent work that can run while the agent continues; use bash when the next step needs the command result immediately.",
			"After starting a watched task, keep its task ID and use wait_watched_task when the task result is needed.",
			"If the agent is still running another turn when a task finishes, no follow-up is sent; query the task by ID when its result is needed.",
		],
		parameters: Type.Object({
			label: Type.String({ description: "Short human-readable task label" }),
			command: Type.String({ description: "Shell command to run asynchronously" }),
			cwd: Type.Optional(Type.String({ description: "Working directory; defaults to the current project directory" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			ui = ctx.ui;
			const task = registry.start({
				label: params.label,
				command: params.command,
				cwd: params.cwd ? resolve(ctx.cwd, params.cwd) : ctx.cwd,
			});
			return {
				content: [{ type: "text", text: `Started watched task ${task.id} (${task.label}). It is running asynchronously.` }],
				details: task,
			};
		},
	});

	pi.registerTool({
		name: "get_watched_task",
		label: "Get watched task",
		description: "Read the current state of an asynchronously running watched task.",
		parameters: Type.Object({
			taskId: Type.String({ description: "Task ID returned by start_watched_task" }),
		}),
		async execute(_toolCallId, params) {
			const task = registry.get(params.taskId);
			if (!task) throw new Error(`Unknown watched task: ${params.taskId}`);
			return { content: [{ type: "text", text: formatTaskForAgent(task) }], details: task };
		},
	});

	pi.registerTool({
		name: "wait_watched_task",
		label: "Wait for watched task",
		description: "Wait until an asynchronous watched task finishes, then return its final state.",
		parameters: Type.Object({
			taskId: Type.String({ description: "Task ID returned by start_watched_task" }),
		}),
		async execute(_toolCallId, params, signal) {
			suppressNotification(params.taskId);
			const task = await registry.wait(params.taskId, signal);
			return { content: [{ type: "text", text: formatTaskForAgent(task) }], details: task };
		},
	});

	pi.registerTool({
		name: "cancel_watched_task",
		label: "Cancel watched task",
		description: "Request cancellation of an asynchronous watched task.",
		parameters: Type.Object({
			taskId: Type.String({ description: "Task ID returned by start_watched_task" }),
		}),
		async execute(_toolCallId, params, signal) {
			suppressNotification(params.taskId);
			const task = await registry.cancelAndWait(params.taskId);
			return { content: [{ type: "text", text: formatTaskForAgent(task) }], details: task };
		},
	});

	pi.registerCommand("watch", {
		description: "Watch asynchronously running tasks",
		getArgumentCompletions: (prefix) => {
			const values = ["list", "archive", "clear", "clear archive", ...registry.list().map((task) => task.id)];
			const matches = values.filter((value) => value.startsWith(prefix));
			return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			ui = ctx.ui;
			const parts = args.trim().split(/\s+/).filter(Boolean);
			if (parts[0] === "clear" && parts[1] === "archive") {
				await archive.clear();
				ctx.ui.notify("Cleared task archive.", "info");
				return;
			}
			if (parts[0] === "clear") {
				const removed = registry.clearFinished();
				ctx.ui.notify(removed > 0 ? `Cleared ${removed} finished task(s).` : "No finished tasks to clear.", "info");
				return;
			}
			if (parts[0] === "stop") {
				if (!parts[1]) {
					ctx.ui.notify("Usage: /watch stop <task-id>", "warning");
					return;
				}
				try {
					const task = await registry.cancelAndWait(parts[1]);
					ctx.ui.notify(`Task ${task.id}: ${task.state}${task.pid ? ` (pid ${task.pid})` : ""}`, task.state === "orphaned" ? "error" : "info");
				} catch (error) {
					ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				}
				return;
			}
			const view: WatchView = parts[0] === "archive" ? "archive" : parts[0] && parts[0] !== "list" ? parts[0] : "all";
			const archived = view === "archive" ? await archive.list() : [];
			if (ctx.mode !== "tui") {
				const entries = view === "archive" ? archived : registry.list();
				ctx.ui.notify(entries.map(formatTaskForAgent).join("\n") || "No watched tasks.", "info");
				return;
			}
			await ctx.ui.custom<null>((tui, theme, _keybindings, done) => new TaskWatchComponent(registry, archived, tui, theme, done, view));
		},
	});
}

class TaskStatusWidget implements Component {
	private readonly timer: NodeJS.Timeout;
	private readonly registry: TaskRegistry;
	private readonly tui: TUI;
	private readonly theme: Theme;

	constructor(registry: TaskRegistry, tui: TUI, theme: Theme) {
		this.registry = registry;
		this.tui = tui;
		this.theme = theme;
		this.timer = setInterval(() => this.tui.requestRender(), 1_000);
	}

	render(_width: number): string[] {
		return this.registry.active().slice(0, 3).map((task) => {
			const glyph = this.theme.fg("accent", taskStateGlyph(task.state));
			const label = this.theme.fg("text", task.label);
			const time = this.theme.fg("muted", elapsed(task.startedAt));
			return `${glyph} ${label}  ${time}`;
		});
	}

	invalidate(): void {}

	dispose(): void {
		clearInterval(this.timer);
	}
}

class TaskWatchComponent implements Component {
	private readonly container = new Container();
	private readonly title: Text;
	private readonly content: Text;
	private readonly timer: NodeJS.Timeout;
	private readonly registry: TaskRegistry;
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly done: (value: null) => void;
	private readonly view: WatchView;
	private readonly archived: ArchivedTask[];

	constructor(registry: TaskRegistry, archived: ArchivedTask[], tui: TUI, theme: Theme, done: (value: null) => void, view: WatchView) {
		this.registry = registry;
		this.archived = archived;
		this.tui = tui;
		this.theme = theme;
		this.done = done;
		this.view = view;
		const border = new DynamicBorder((line: string) => theme.fg("accent", line));
		const body = new Box(1, 0, (line: string) => theme.bg("customMessageBg", line));
		this.title = new Text("", 1, 0);
		this.content = new Text("", 1, 0);
		body.addChild(this.title);
		body.addChild(this.content);
		body.addChild(new Text(theme.fg("dim", "q / Escape close  •  /watch stop <task-id> cancel"), 1, 0));
		this.container.addChild(border);
		this.container.addChild(body);
		this.container.addChild(border);
		this.refresh();
		this.timer = setInterval(() => {
			this.refresh();
			this.tui.requestRender();
		}, 1000);
	}

	render(width: number): string[] {
		return this.container.render(width);
	}

	handleInput(data: string): void {
		if (data === "q" || data === "\x1b" || data === "\x03") this.done(null);
	}

	invalidate(): void {
		this.container.invalidate();
	}

	dispose(): void {
		clearInterval(this.timer);
	}

	private refresh(): void {
		const tasks = this.view === "archive"
			? this.archived
			: this.registry.list().filter((task) => this.view === "all" || task.id === this.view);
		const title = this.view === "archive" ? "Task archive" : this.view === "all" ? "Watched tasks" : `Watched task ${this.view}`;
		this.title.setText(this.theme.fg("accent", this.theme.bold(title)));
		const lines = tasks.length === 0
			? [this.theme.fg("muted", "No watched tasks.")]
			: tasks.flatMap((task) => [
					`${stateColor(this.theme, task.state)(taskStateGlyph(task.state))} ${task.id}  ${stateColor(this.theme, task.state)(task.state)}  ${elapsed(task.startedAt, task.finishedAt ?? Date.now())}  ${task.label}`,
					...(task.latestMessage ? [`  ${this.theme.fg("muted", task.latestMessage)}`] : []),
			  ]);
		this.content.setText(lines.join("\n"));
	}
}

function stateColor(theme: Theme, state: WatchedTask["state"]): (text: string) => string {
	if (state === "succeeded") return (text) => theme.fg("success", text);
	if (state === "failed" || state === "orphaned") return (text) => theme.fg("error", text);
	if (state === "cancelled") return (text) => theme.fg("muted", text);
	return (text) => theme.fg("accent", text);
}

function formatTaskForAgent(task: WatchedTask | ArchivedTask): string {
	const output = [
	`Task ${task.id} (${task.label})`,
	`state: ${task.state}`,
	`elapsed: ${elapsed(task.startedAt, task.finishedAt ?? Date.now())}`,
	];
	if (task.exitCode !== undefined) output.push(`exitCode: ${task.exitCode ?? "signal"}`);
	if (task.pid !== undefined) output.push(`pid: ${task.pid}`);
	if (task.latestMessage) output.push(`latestOutput: ${task.latestMessage}`);
	return output.join("\n");
}
