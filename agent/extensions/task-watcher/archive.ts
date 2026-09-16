import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { TaskState, WatchedTask } from "./task.ts";

export interface ArchivedTask {
	id: string;
	label: string;
	state: Exclude<TaskState, "running">;
	startedAt: number;
	finishedAt: number;
	exitCode?: number | null;
}

const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 500;

export interface TaskArchiveOptions {
	path?: string;
	retentionMs?: number;
	maxEntries?: number;
	now?: () => number;
}

export class TaskArchive {
	private readonly path: string;
	private readonly retentionMs: number;
	private readonly maxEntries: number;
	private readonly now: () => number;
	private pending: Promise<void> = Promise.resolve();

	constructor(options: TaskArchiveOptions = {}) {
		this.path = options.path ?? defaultArchivePath();
		this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
		this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
		this.now = options.now ?? Date.now;
	}

	append(task: WatchedTask): Promise<void> {
		if (task.state === "running" || task.finishedAt === undefined) return Promise.resolve();
		const archived: ArchivedTask = {
			id: task.id,
			label: task.label,
			state: task.state,
			startedAt: task.startedAt,
			finishedAt: task.finishedAt,
			...(task.exitCode === undefined ? {} : { exitCode: task.exitCode }),
		};
		return this.enqueue(async () => {
			const entries = await this.readEntries();
			entries.push(archived);
			await this.writeEntries(this.pruneEntries(entries));
		});
	}

	appendMany(tasks: WatchedTask[]): Promise<void> {
		const archived = tasks.filter((task): task is WatchedTask & { state: Exclude<TaskState, "running">; finishedAt: number } => task.state !== "running" && task.finishedAt !== undefined);
		if (archived.length === 0) return Promise.resolve();
		return this.enqueue(async () => {
			const entries = await this.readEntries();
			entries.push(...archived.map(toArchivedTask));
			await this.writeEntries(this.pruneEntries(entries));
		});
	}

	list(): Promise<ArchivedTask[]> {
		return this.enqueue(async () => {
			const entries = this.pruneEntries(await this.readEntries());
			await this.writeEntries(entries);
			return entries;
		});
	}

	clear(): Promise<void> {
		return this.enqueue(async () => {
			try {
				await writeFile(this.path, "", { encoding: "utf8", mode: 0o600 });
			} catch (error) {
				if (!isMissingFile(error)) throw error;
			}
		});
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const next = this.pending.then(operation);
		this.pending = next.then(() => undefined, () => undefined);
		return next;
	}

	private async readEntries(): Promise<ArchivedTask[]> {
		let contents: string;
		try {
			contents = await readFile(this.path, "utf8");
		} catch (error) {
			if (isMissingFile(error)) return [];
			throw error;
		}
		const entries: ArchivedTask[] = [];
		for (const line of contents.split("\n")) {
			if (!line.trim()) continue;
			try {
				const value = JSON.parse(line) as ArchivedTask;
				if (isArchivedTask(value)) entries.push(value);
			} catch {
				// Ignore one damaged archive line and preserve the rest.
			}
		}
		return entries;
	}

	private pruneEntries(entries: ArchivedTask[]): ArchivedTask[] {
		const cutoff = this.now() - this.retentionMs;
		const newest = entries
			.filter((entry) => entry.finishedAt >= cutoff)
			.sort((left, right) => right.finishedAt - left.finishedAt)
			.slice(0, this.maxEntries);
		return newest;
	}

	private async writeEntries(entries: ArchivedTask[]): Promise<void> {
		if (entries.length === 0) {
			try {
				await writeFile(this.path, "", { encoding: "utf8", mode: 0o600 });
			} catch (error) {
				if (!isMissingFile(error)) throw error;
			}
			return;
		}
		await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
		const contents = entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
		const temporaryPath = `${this.path}.pending-${process.pid}`;
		await writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
		await rename(temporaryPath, this.path);
	}
}

function toArchivedTask(task: WatchedTask & { state: Exclude<TaskState, "running">; finishedAt: number }): ArchivedTask {
	return {
		id: task.id,
		label: task.label,
		state: task.state,
		startedAt: task.startedAt,
		finishedAt: task.finishedAt,
		...(task.exitCode === undefined ? {} : { exitCode: task.exitCode }),
	};
}

function isArchivedTask(value: ArchivedTask): boolean {
	return typeof value?.id === "string"
		&& typeof value.label === "string"
		&& value.state !== "running"
		&& typeof value.startedAt === "number"
		&& typeof value.finishedAt === "number";
}

function isMissingFile(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function defaultArchivePath(): string {
	return join(homedir(), ".local", "share", "pi-task-watcher", "archive.jsonl");
}
