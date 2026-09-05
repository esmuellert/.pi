import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext, TurnEndEvent } from "@earendil-works/pi-coding-agent";

import type { QuotaSnapshot } from "./quota.ts";

interface UsageLike {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	reasoning?: number;
	totalTokens?: number;
	cost?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
		total?: number;
	};
}

interface AssistantLike {
	role: "assistant";
	content: Array<{ type: string; name?: string }>;
	api: string;
	provider: string;
	model: string;
	responseModel?: string;
	providerThinkingLevel?: string;
	usage: UsageLike;
	stopReason: string;
	timestamp: number;
}

interface ToolResultLike {
	toolName: string;
	isError: boolean;
	usage?: UsageLike;
}

export interface NumericUsage {
	input: number;
	cacheRead: number;
	cacheWrite: number;
	output: number;
	reasoning: number | null;
	totalTokens: number;
	estimatedCostUsd: {
		input: number;
		cacheRead: number;
		cacheWrite: number;
		output: number;
		total: number;
	};
}

export interface ReplyDraft {
	schemaVersion: 2;
	type: "reply";
	id: string;
	processRef: string;
	sessionRef: string;
	startedAt: string;
	startModel: {
		provider: string;
		api: string;
		id: string;
		thinkingLevel: string;
	} | null;
	turns: TurnRecord[];
}

export interface TurnRecord {
	turnIndex: number;
	startedAt: string | null;
	endedAt: string;
	durationMs: number | null;
	model: {
		provider: string;
		api: string;
		requested: string;
		responded: string | null;
		thinkingLevel: string;
		providerThinkingLevel: string | null;
	};
	stopReason: string;
	usage: NumericUsage;
	tools: {
		requested: string[];
		completed: number;
		errors: number;
		byName: Record<string, number>;
		nestedUsage: NumericUsage;
	};
}

export interface ReplyRecord extends ReplyDraft {
	quotaBefore: QuotaSnapshot | null;
	quotaAfter: QuotaSnapshot | null;
	endedAt: string;
	durationMs: number;
	totals: {
		model: NumericUsage;
		nestedTools: NumericUsage;
		turns: number;
		toolCalls: number;
		toolErrors: number;
	};
}

const emptyUsage = (): NumericUsage => ({
	input: 0,
	cacheRead: 0,
	cacheWrite: 0,
	output: 0,
	reasoning: null,
	totalTokens: 0,
	estimatedCostUsd: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 },
});

export function numericUsage(usage: UsageLike | undefined): NumericUsage {
	if (!usage) return emptyUsage();
	return {
		input: usage.input ?? 0,
		cacheRead: usage.cacheRead ?? 0,
		cacheWrite: usage.cacheWrite ?? 0,
		output: usage.output ?? 0,
		reasoning: usage.reasoning ?? null,
		totalTokens: usage.totalTokens ??
			(usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0) + (usage.output ?? 0),
		estimatedCostUsd: {
			input: usage.cost?.input ?? 0,
			cacheRead: usage.cost?.cacheRead ?? 0,
			cacheWrite: usage.cost?.cacheWrite ?? 0,
			output: usage.cost?.output ?? 0,
			total: usage.cost?.total ?? 0,
		},
	};
}

function addUsage(target: NumericUsage, value: NumericUsage): void {
	target.input += value.input;
	target.cacheRead += value.cacheRead;
	target.cacheWrite += value.cacheWrite;
	target.output += value.output;
	target.totalTokens += value.totalTokens;
	if (value.reasoning !== null) target.reasoning = (target.reasoning ?? 0) + value.reasoning;
	target.estimatedCostUsd.input += value.estimatedCostUsd.input;
	target.estimatedCostUsd.cacheRead += value.estimatedCostUsd.cacheRead;
	target.estimatedCostUsd.cacheWrite += value.estimatedCostUsd.cacheWrite;
	target.estimatedCostUsd.output += value.estimatedCostUsd.output;
	target.estimatedCostUsd.total += value.estimatedCostUsd.total;
}

export function hashSessionId(sessionId: string): string {
	return createHash("sha256").update(sessionId).digest("hex");
}

export function startReply(
	ctx: ExtensionContext,
	processRef: string,
	now = Date.now(),
	id: string = randomUUID(),
): ReplyDraft {
	const model = ctx.model;
	return {
		schemaVersion: 2,
		type: "reply",
		id,
		processRef,
		sessionRef: hashSessionId(ctx.sessionManager.getSessionId()),
		startedAt: new Date(now).toISOString(),
		startModel: model ? {
			provider: model.provider,
			api: model.api,
			id: model.id,
			thinkingLevel: ctx.thinkingLevel ?? "off",
		} : null,
		turns: [],
	};
}

function toolSummary(results: readonly ToolResultLike[]): TurnRecord["tools"] {
	const byName: Record<string, number> = {};
	const nestedUsage = emptyUsage();
	let errors = 0;
	for (const result of results) {
		byName[result.toolName] = (byName[result.toolName] ?? 0) + 1;
		if (result.isError) errors += 1;
		addUsage(nestedUsage, numericUsage(result.usage));
	}
	return {
		requested: [],
		completed: results.length,
		errors,
		byName,
		nestedUsage,
	};
}

export function addTurn(
	draft: ReplyDraft,
	event: TurnEndEvent,
	thinkingLevel: string,
	startedAt: number | undefined,
	now = Date.now(),
): void {
	if (event.message.role !== "assistant") return;
	const message = event.message as AssistantLike;
	const tools = toolSummary(event.toolResults as readonly ToolResultLike[]);
	tools.requested = message.content
		.filter((part) => part.type === "toolCall" && typeof part.name === "string")
		.map((call) => call.name!);
	const endedAt = Math.max(now, message.timestamp ?? 0);
	draft.turns.push({
		turnIndex: event.turnIndex,
		startedAt: startedAt === undefined ? null : new Date(startedAt).toISOString(),
		endedAt: new Date(endedAt).toISOString(),
		durationMs: startedAt === undefined ? null : Math.max(0, endedAt - startedAt),
		model: {
			provider: message.provider,
			api: message.api,
			requested: message.model,
			responded: message.responseModel ?? null,
			thinkingLevel,
			providerThinkingLevel: message.providerThinkingLevel ?? null,
		},
		stopReason: message.stopReason,
		usage: numericUsage(message.usage),
		tools,
	});
}

export function finishReply(
	draft: ReplyDraft,
	now = Date.now(),
	quotaBefore: QuotaSnapshot | null = null,
	quotaAfter: QuotaSnapshot | null = null,
): ReplyRecord {
	const model = emptyUsage();
	const nestedTools = emptyUsage();
	let toolCalls = 0;
	let toolErrors = 0;
	for (const turn of draft.turns) {
		addUsage(model, turn.usage);
		addUsage(nestedTools, turn.tools.nestedUsage);
		toolCalls += turn.tools.requested.length;
		toolErrors += turn.tools.errors;
	}
	const startedAt = Date.parse(draft.startedAt);
	return {
		...draft,
		quotaBefore,
		quotaAfter,
		endedAt: new Date(now).toISOString(),
		durationMs: Math.max(0, now - startedAt),
		totals: {
			model,
			nestedTools,
			turns: draft.turns.length,
			toolCalls,
			toolErrors,
		},
	};
}

export function defaultDataDir(
	env: NodeJS.ProcessEnv = process.env,
	platform = process.platform,
	home = homedir(),
): string {
	if (env.PI_CODEX_STATISTICS_DATA_DIR) return env.PI_CODEX_STATISTICS_DATA_DIR;
	if (platform === "win32") return join(env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "pi-codex-statistics");
	return join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "pi-codex-statistics");
}

export class JsonlLedger {
	private pending: Promise<void> = Promise.resolve();
	private readonly directory: string;

	constructor(directory = defaultDataDir()) {
		this.directory = directory;
	}

	append(record: ReplyRecord): Promise<void> {
		const day = record.endedAt.slice(0, 10);
		const path = join(this.directory, `usage-${day}.jsonl`);
		const line = `${JSON.stringify(record)}\n`;
		const write = this.pending.catch(() => {}).then(async () => {
			await mkdir(this.directory, { recursive: true, mode: 0o700 });
			await appendFile(path, line, { encoding: "utf8", mode: 0o600 });
		});
		this.pending = write;
		return write;
	}

	flush(): Promise<void> {
		return this.pending;
	}
}
