export interface QuotaWindow {
	usedPercent: number;
	windowSeconds: number;
	resetAt: number | null;
}

export interface QuotaSnapshot {
	fetchedAt: number;
	planType: string | null;
	primary: QuotaWindow;
	secondary: QuotaWindow;
}

interface FetchQuotaOptions {
	apiKey: string;
	accountId?: string;
	fetchImpl?: typeof fetch;
	now?: () => number;
	signal?: AbortSignal;
	timeoutMs?: number;
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
	const resetAt = finite(raw.reset_at);
	return {
		usedPercent: Math.max(0, Math.min(100, usedPercent)),
		windowSeconds,
		resetAt,
	};
}

export function parseQuota(payload: unknown, fetchedAt = Date.now()): QuotaSnapshot | null {
	const root = record(payload);
	const limits = record(root?.rate_limit);
	const primary = parseWindow(limits?.primary_window);
	const secondary = parseWindow(limits?.secondary_window);
	if (!primary || !secondary) return null;
	return {
		fetchedAt,
		planType: typeof root?.plan_type === "string" ? root.plan_type : null,
		primary,
		secondary,
	};
}

function decodeBase64Url(value: string): string {
	const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
	return Buffer.from(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="), "base64").toString("utf8");
}

/** Extracted only for the request header; it is never returned or persisted. */
export function extractAccountId(accessToken: string): string | undefined {
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

export async function fetchQuota(options: FetchQuotaOptions): Promise<QuotaSnapshot> {
	const {
		apiKey,
		accountId,
		fetchImpl = fetch,
		now = Date.now,
		signal,
		timeoutMs = 8_000,
	} = options;
	const timeout = AbortSignal.timeout(timeoutMs);
	const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
	const response = await fetchImpl(USAGE_URL, {
		headers: {
			authorization: `Bearer ${apiKey}`,
			accept: "application/json",
			"user-agent": "pi-codex-study",
			...(accountId ? { "chatgpt-account-id": accountId } : {}),
		},
		signal: requestSignal,
	});
	if (!response.ok) throw new Error(`Codex usage request failed (${response.status})`);
	const snapshot = parseQuota(await response.json(), now());
	if (!snapshot) throw new Error("Codex usage response did not contain both quota windows");
	return snapshot;
}
