import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

export type TaskState = "running" | "succeeded" | "failed" | "cancelled" | "orphaned";

export interface WatchedTask {
	id: string;
	label: string;
	state: TaskState;
	startedAt: number;
	updatedAt: number;
	finishedAt?: number;
	exitCode?: number | null;
	latestMessage?: string;
	pid?: number;
}

interface RunningTask extends WatchedTask {
	process: ChildProcess;
	cancelRequested: boolean;
	waiters: Set<(task: WatchedTask) => void>;
	outputBuffer: string;
}

export interface StartTaskOptions {
	label: string;
	command: string;
	cwd: string;
	environment?: NodeJS.ProcessEnv;
	now?: () => number;
	randomId?: () => string;
}

export interface TaskRegistryOptions {
	now?: () => number;
	randomId?: () => string;
	onChange?: () => void;
	onFinish?: (task: WatchedTask, hadWaiter: boolean) => void;
	onArchive?: (tasks: WatchedTask[]) => void;
	archiveAfterMs?: number;
}

export class TaskRegistry {
	private readonly tasks = new Map<string, RunningTask>();
	private readonly now: () => number;
	private readonly randomId: () => string;
	private readonly onChange?: () => void;
	private readonly onFinish?: (task: WatchedTask, hadWaiter: boolean) => void;
	private readonly onArchive?: (tasks: WatchedTask[]) => void;
	private readonly archiveAfterMs: number;
	private static readonly terminateGraceMs = 2_000;
	private static readonly forceKillGraceMs = 1_000;

	constructor(options: TaskRegistryOptions = {}) {
		this.now = options.now ?? Date.now;
		this.randomId = options.randomId ?? (() => randomUUID().slice(0, 8));
		this.onChange = options.onChange;
		this.onFinish = options.onFinish;
		this.onArchive = options.onArchive;
		this.archiveAfterMs = options.archiveAfterMs ?? 30 * 60 * 1000;
	}

	start(options: StartTaskOptions): WatchedTask {
		const startedAt = (options.now ?? this.now)();
		const id = `task-${(options.randomId ?? this.randomId)()}`;
		const child = spawn(options.command, {
			cwd: resolve(options.cwd),
			env: { ...process.env, ...options.environment, PI_TASK_ID: id },
			shell: true,
			detached: process.platform !== "win32",
			stdio: ["ignore", "pipe", "pipe"],
		});
		const task: RunningTask = {
			id,
			label: options.label,
			state: "running",
			startedAt,
			updatedAt: startedAt,
			process: child,
			cancelRequested: false,
			waiters: new Set(),
			outputBuffer: "",
		};
		this.tasks.set(id, task);
		this.observeOutput(task, child.stdout);
		this.observeOutput(task, child.stderr);
		child.once("error", (error) => {
			task.latestMessage = error.message;
			this.finish(task, "failed", null);
		});
		child.once("close", (exitCode) => {
			if (task.state !== "running") return;
			this.finish(task, task.cancelRequested ? "cancelled" : exitCode === 0 ? "succeeded" : "failed", exitCode);
		});
		this.onChange?.();
		return this.snapshot(task);
	}

	get(id: string): WatchedTask | undefined {
		const task = this.tasks.get(id);
		return task ? this.snapshot(task) : undefined;
	}

	list(): WatchedTask[] {
		return [...this.tasks.values()]
			.sort((left, right) => right.startedAt - left.startedAt)
			.map((task) => this.snapshot(task));
	}

	active(): WatchedTask[] {
		return this.list().filter((task) => task.state === "running");
	}

	sweepExpired(): WatchedTask[] {
		const cutoff = this.now() - this.archiveAfterMs;
		const archived: WatchedTask[] = [];
		for (const [id, task] of this.tasks) {
			if (task.state !== "running" && task.finishedAt !== undefined && task.finishedAt <= cutoff) {
				archived.push(this.snapshot(task));
				this.tasks.delete(id);
			}
		}
		if (archived.length > 0) {
			this.onArchive?.(archived);
			this.onChange?.();
		}
		return archived;
	}

	removeFinished(): WatchedTask[] {
		const finished: WatchedTask[] = [];
		for (const [id, task] of this.tasks) {
			if (task.state !== "running") {
				finished.push(this.snapshot(task));
				this.tasks.delete(id);
			}
		}
		if (finished.length > 0) this.onChange?.();
		return finished;
	}

	clearFinished(): number {
		let removed = 0;
		for (const [id, task] of this.tasks) {
			if (task.state !== "running") {
				this.tasks.delete(id);
				removed += 1;
			}
		}
		if (removed > 0) this.onChange?.();
		return removed;
	}

	cancel(id: string): boolean {
		const task = this.tasks.get(id);
		if (!task || task.state !== "running") return false;
		this.requestCancel(task, "SIGTERM");
		return true;
	}

	async cancelAndWait(id: string): Promise<WatchedTask> {
		const task = this.tasks.get(id);
		if (!task) throw new Error(`Unknown watched task: ${id}`);
		if (task.state !== "running") return this.snapshot(task);

		this.requestCancel(task, "SIGTERM");
		const terminated = await this.waitForExit(task, TaskRegistry.terminateGraceMs);
		if (terminated) return terminated;

		this.requestCancel(task, "SIGKILL");
		const forceKilled = await this.waitForExit(task, TaskRegistry.forceKillGraceMs);
		if (forceKilled) return forceKilled;

		task.latestMessage = `Process ${task.process.pid ?? "unknown"} did not exit after cancellation`;
		this.finish(task, "orphaned", null);
		return this.snapshot(task);
	}

	wait(id: string, signal?: AbortSignal): Promise<WatchedTask> {
		const task = this.tasks.get(id);
		if (!task) return Promise.reject(new Error(`Unknown watched task: ${id}`));
		if (task.state !== "running") return Promise.resolve(this.snapshot(task));
		return new Promise((resolveTask, reject) => {
			const resolveAndClean = (finishedTask: WatchedTask) => {
				signal?.removeEventListener("abort", abort);
				resolveTask(finishedTask);
			};
			const abort = () => {
				task.waiters.delete(resolveAndClean);
				reject(new Error("Waiting for watched task was cancelled"));
			};
			task.waiters.add(resolveAndClean);
			if (signal?.aborted) abort();
			signal?.addEventListener("abort", abort, { once: true });
		});
	}

	async cancelAll(): Promise<void> {
		const running = this.list().filter((task) => task.state === "running");
		await Promise.all(running.map((task) => this.cancelAndWait(task.id).catch(() => undefined)));
	}

	private requestCancel(task: RunningTask, signal: "SIGTERM" | "SIGKILL"): void {
		task.cancelRequested = true;
		if (task.process.pid && process.platform !== "win32") {
			try {
				process.kill(-task.process.pid, signal);
			} catch {
				try {
					task.process.kill(signal);
				} catch {
					// The process may have exited between the group and child checks.
				}
			}
		} else {
			try {
				task.process.kill(signal);
			} catch {
				// The process may have exited already.
			}
		}
		task.updatedAt = this.now();
		this.onChange?.();
	}

	private async waitForExit(task: RunningTask, timeoutMs: number): Promise<WatchedTask | undefined> {
		try {
			return await this.wait(task.id, AbortSignal.timeout(timeoutMs));
		} catch {
			return task.state === "running" ? undefined : this.snapshot(task);
		}
	}

	private observeOutput(task: RunningTask, stream: NodeJS.ReadableStream | null): void {
		stream?.on("data", (chunk: Buffer | string) => {
			const text = String(chunk);
			task.outputBuffer = `${task.outputBuffer}${text}`.slice(-4000);
			const lines = task.outputBuffer.split(/\r?\n/).filter(Boolean);
			task.latestMessage = lines.at(-1)?.trim().slice(-240) || task.latestMessage;
			task.updatedAt = this.now();
			this.onChange?.();
		});
	}

	private finish(task: RunningTask, state: TaskState, exitCode: number | null): void {
		if (task.state !== "running") return;
		task.state = state;
		task.exitCode = exitCode;
		task.finishedAt = this.now();
		task.updatedAt = task.finishedAt;
		const snapshot = this.snapshot(task);
		const hadWaiter = task.waiters.size > 0;
		for (const waiter of task.waiters) waiter(snapshot);
		task.waiters.clear();
		this.onChange?.();
		this.onFinish?.(snapshot, hadWaiter);
	}

	private snapshot(task: RunningTask): WatchedTask {
		return {
			id: task.id,
			label: task.label,
			state: task.state,
			startedAt: task.startedAt,
			updatedAt: task.updatedAt,
			...(task.finishedAt === undefined ? {} : { finishedAt: task.finishedAt }),
			...(task.exitCode === undefined ? {} : { exitCode: task.exitCode }),
			...(task.latestMessage ? { latestMessage: task.latestMessage } : {}),
			...(task.process.pid === undefined ? {} : { pid: task.process.pid }),
		};
	}
}

export function elapsed(ms: number, now = Date.now()): string {
	const seconds = Math.max(0, Math.floor((now - ms) / 1000));
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
	return `${Math.floor(seconds / 3600)}h${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}m`;
}

export function taskStateGlyph(state: TaskState): string {
	switch (state) {
		case "running": return "●";
		case "succeeded": return "✓";
		case "failed": return "✗";
		case "cancelled": return "-";
		case "orphaned": return "!";
	}
}
