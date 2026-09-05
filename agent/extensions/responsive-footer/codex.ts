import type { Segment } from "./layout.ts";

export interface QuotaWindow {
	usedPercent: number;
	windowSeconds: number;
	resetAt: number | null;
}

export interface QuotaSnapshot {
	fetchedAt: number;
	primary: QuotaWindow;
	secondary: QuotaWindow;
}

interface FetchQuotaOptions {
	apiKey: string;
	accountId?: string;
	fetchImpl?: typeof fetch;
	now?: () => number;
	signal?: AbortSignal;
}

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function finite(value: unknown): number | null {
	const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
	return Number.isFinite(number) ? number : null;
}

function parseWindow(value: unknown): QuotaWindow | null {
	const raw = record(value);
	if (!raw) return null;
	const usedPercent = finite(raw.used_percent);
	const windowSeconds = finite(raw.limit_window_seconds);
	if (usedPercent === null || windowSeconds === null || windowSeconds <= 0) return null;
	return {
		usedPercent: Math.max(0, Math.min(100, usedPercent)),
		windowSeconds,
		resetAt: finite(raw.reset_at),
	};
}

export function parseCodexQuota(payload: unknown, fetchedAt = Date.now()): QuotaSnapshot | null {
	const limits = record(record(payload)?.rate_limit);
	const primary = parseWindow(limits?.primary_window);
	const secondary = parseWindow(limits?.secondary_window);
	return primary && secondary ? { fetchedAt, primary, secondary } : null;
}

function decodeBase64Url(value: string): string {
	const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
	return Buffer.from(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="), "base64").toString("utf8");
}

/** Extracted only for the request header; it is never retained by the footer. */
export function extractCodexAccountId(accessToken: string): string | undefined {
	const payload = accessToken.split(".")[1];
	if (!payload) return undefined;
	try {
		const claims = record(JSON.parse(decodeBase64Url(payload)));
		const auth = record(claims?.["https://api.openai.com/auth"]);
		const id = auth?.chatgpt_account_id;
		return typeof id === "string" && id.length > 0 ? id : undefined;
	} catch {
		return undefined;
	}
}

export async function fetchCodexQuota(options: FetchQuotaOptions): Promise<QuotaSnapshot> {
	const timeout = AbortSignal.timeout(8_000);
	const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
	const response = await (options.fetchImpl ?? fetch)(USAGE_URL, {
		headers: {
			authorization: `Bearer ${options.apiKey}`,
			accept: "application/json",
			"user-agent": "pi-responsive-footer",
			...(options.accountId ? { "chatgpt-account-id": options.accountId } : {}),
		},
		signal,
	});
	if (!response.ok) throw new Error(`Codex usage request failed (${response.status})`);
	const snapshot = parseCodexQuota(await response.json(), (options.now ?? Date.now)());
	if (!snapshot) throw new Error("Codex usage response did not contain both quota windows");
	return snapshot;
}

function resetText(resetAt: number | null, now: number): string {
	if (resetAt === null) return "—";
	const seconds = resetAt - Math.floor(now / 1000);
	if (seconds <= 0) return "now";
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
	if (seconds < 86_400) {
		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		return minutes === 0 ? `${hours}h` : `${hours}h${String(minutes).padStart(2, "0")}m`;
	}
	return `${Math.floor(seconds / 86_400)}d`;
}

function quotaBar(percent: number): string {
	const filled = Math.max(0, Math.min(6, Math.round((percent / 100) * 6)));
	return "█".repeat(filled) + "░".repeat(6 - filled);
}

function quotaColor(percent: number): string {
	return percent >= 90 ? "error" : percent >= 75 ? "warning" : "muted";
}

function quotaSegment(id: string, window: QuotaWindow, now: number): Segment {
	const used = Math.max(0, Math.min(100, window.usedPercent));
	return {
		id,
		text: `${resetText(window.resetAt, now)} ${quotaBar(used)} ${used.toFixed(0)}%`,
		color: quotaColor(used),
	};
}

/** The same compact reset + six-cell pressure bars used by the local Claude Code status line. */
export function codexQuotaSegments(quota: QuotaSnapshot, now = Date.now()): Segment[] {
	return [
		quotaSegment("codex-5h", quota.primary, now),
		quotaSegment("codex-week", quota.secondary, now),
	];
}
