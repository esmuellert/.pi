import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const COMPACTION_THINKING_LEVEL = "low" as const;

const ABOVE_LOW = new Set(["medium", "high", "xhigh", "max"]);
type Payload = Record<string, unknown>;

function isPayload(value: unknown): value is Payload {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shouldClamp(value: unknown): boolean {
	return typeof value === "string" && ABOVE_LOW.has(value);
}

function clampNestedEffort(payload: Payload, key: "reasoning" | "output_config"): Payload {
	const nested = payload[key];
	if (!isPayload(nested) || !shouldClamp(nested.effort)) return payload;
	return { ...payload, [key]: { ...nested, effort: COMPACTION_THINKING_LEVEL } };
}

/** Lower explicit provider effort fields without adding reasoning to an off request. */
export function clampCompactionEffort(payload: unknown): unknown {
	if (!isPayload(payload)) return payload;

	let clamped = payload;
	if (shouldClamp(clamped.reasoning_effort)) {
		clamped = { ...clamped, reasoning_effort: COMPACTION_THINKING_LEVEL };
	}
	clamped = clampNestedEffort(clamped, "reasoning");
	clamped = clampNestedEffort(clamped, "output_config");
	return clamped;
}

export function installCompactionEffort(pi: ExtensionAPI): void {
	let compacting = false;

	pi.on("session_before_compact", () => {
		compacting = true;
	});

	pi.on("before_provider_request", (event) => {
		if (!compacting) return;
		const payload = clampCompactionEffort(event.payload);
		return payload === event.payload ? undefined : payload;
	});

	const finish = () => {
		compacting = false;
	};
	pi.on("session_compact", finish);
	pi.on("session_compact_failed", finish);
	pi.on("session_shutdown", finish);
}

export default installCompactionEffort;
