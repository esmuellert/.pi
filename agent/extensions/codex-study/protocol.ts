import type { QuotaSnapshot } from "./quota.ts";

export type { QuotaSnapshot, QuotaWindow } from "./quota.ts";

export const CODEX_USAGE_STATE_EVENT = "codex-study:state";

export interface CodexUsageState {
	verified: boolean;
	quota: QuotaSnapshot | null;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function isQuotaWindow(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const window = value as Record<string, unknown>;
	return finite(window.usedPercent) && finite(window.windowSeconds) &&
		(window.resetAt === null || finite(window.resetAt));
}

export function isCodexUsageState(value: unknown): value is CodexUsageState {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const state = value as Partial<CodexUsageState>;
	if (state.verified === false) return state.quota === null;
	if (state.verified !== true || !state.quota || typeof state.quota !== "object") return false;
	return Number.isFinite(state.quota.fetchedAt) &&
		isQuotaWindow(state.quota.primary) && isQuotaWindow(state.quota.secondary);
}
