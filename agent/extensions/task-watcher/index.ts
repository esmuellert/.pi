import { resolve } from "node:path";
import { DynamicBorder, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Box, Container, Text, type Component, type TUI } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import { elapsed, TaskRegistry, taskStateGlyph, type WatchedTask } from "./task.ts";

const WIDGET_KEY = "task-watcher";
type WatchView = "all" | string;

export default function taskWatcher(pi: ExtensionAPI): void {
	let ui: ExtensionContext["ui"] | undefined;
	const registry = new TaskRegistry({
		onChange: () => renderWidget(),
		onFinish: (task) => notifyAgent(task),
	});

	function renderWidget(): void {
		if (!ui) return;
		const active = registry.active();
		if (active.length === 0) {
			ui.setWidget(WIDGET_KEY, undefined);
			return;
		}
		ui.setWidget(
			WIDGET_KEY,
			active.slice(0, 3).map((task) => `${taskStateGlyph(task.state)} ${task.label}  ${elapsed(task.startedAt)}`),
			{ placement: "aboveEditor" },
		);
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
		ui = ctx.ui;
		renderWidget();
	});

	pi.on("session_shutdown", async () => {
		registry.cancelAll();
		ui?.setWidget(WIDGET_KEY, undefined);
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
		async execute(_toolCallId, params) {
			if (!registry.cancel(params.taskId)) throw new Error(`Watched task is not running: ${params.taskId}`);
			const task = registry.get(params.taskId);
			return { content: [{ type: "text", text: `Cancellation requested for ${params.taskId}.` }], details: task };
		},
	});

	pi.registerCommand("watch", {
		description: "Watch asynchronously running tasks",
		getArgumentCompletions: (prefix) => {
			const values = ["list", "clear", ...registry.list().map((task) => task.id)];
			const matches = values.filter((value) => value.startsWith(prefix));
			return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			ui = ctx.ui;
			const parts = args.trim().split(/\s+/).filter(Boolean);
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
				ctx.ui.notify(registry.cancel(parts[1]) ? `Cancellation requested for ${parts[1]}.` : `Task is not running: ${parts[1]}`, "info");
				return;
			}
			if (ctx.mode !== "tui") {
				ctx.ui.notify(registry.list().map(formatTaskForAgent).join("\n") || "No watched tasks.", "info");
				return;
			}
			const view: WatchView = parts[0] && parts[0] !== "list" ? parts[0] : "all";
			await ctx.ui.custom<null>((tui, theme, _keybindings, done) => new TaskWatchComponent(registry, tui, theme, done, view));
		},
	});
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

	constructor(registry: TaskRegistry, tui: TUI, theme: Theme, done: (value: null) => void, view: WatchView) {
		this.registry = registry;
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
		const tasks = this.registry.list().filter((task) => this.view === "all" || task.id === this.view);
		const title = this.view === "all" ? "Watched tasks" : `Watched task ${this.view}`;
		this.title.setText(this.theme.fg("accent", this.theme.bold(title)));
		const lines = tasks.length === 0
			? [this.theme.fg("muted", "No watched tasks.")]
			: tasks.flatMap((task) => [
					`${stateColor(this.theme, task.state)(taskStateGlyph(task.state))} ${task.id}  ${stateColor(this.theme, task.state)(task.state)}  ${elapsed(task.startedAt)}  ${task.label}`,
					...(task.latestMessage ? [`  ${this.theme.fg("muted", task.latestMessage)}`] : []),
			  ]);
		this.content.setText(lines.join("\n"));
	}
}

function stateColor(theme: Theme, state: WatchedTask["state"]): (text: string) => string {
	if (state === "succeeded") return (text) => theme.fg("success", text);
	if (state === "failed") return (text) => theme.fg("error", text);
	if (state === "cancelled") return (text) => theme.fg("muted", text);
	return (text) => theme.fg("accent", text);
}

function formatTaskForAgent(task: WatchedTask): string {
	const output = [
	`Task ${task.id} (${task.label})`,
	`state: ${task.state}`,
	`elapsed: ${elapsed(task.startedAt, task.finishedAt ?? Date.now())}`,
	];
	if (task.exitCode !== undefined) output.push(`exitCode: ${task.exitCode ?? "signal"}`);
	if (task.latestMessage) output.push(`latestOutput: ${task.latestMessage}`);
	return output.join("\n");
}
