import type { QuotaSnapshot, QuotaWindow } from "pi-codex-study/protocol";
import type { Segment } from "./layout.ts";

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
