/**
 * What a finished pi turn looks like to Moshi, and why it takes two events.
 *
 * Moshi decides whether an agent event reaches the phone as a visible banner
 * from its `category` alone: only `approval_required` and `error` ring, and
 * `task_complete` is documented as updating the Live Activity *without* a
 * separate notification. That is a deliberate product decision with no opt-in,
 * and it is what leaves a pi user with no audible signal at all — the Moshi
 * integration for pi never emits an approval either, so nothing it sends can
 * ring. Probing the live API confirmed the rule rather than finding a way past
 * it: `eventType`, `silent: false`, the undocumented `info` category and
 * `session_ended` all leave the phone quiet.
 *
 * A session's card also shows the state of whichever event arrived last, so an
 * `error` sent to announce a finished turn leaves that card reading WORKING.
 *
 * Hence two events, in this order:
 *
 *   1. category `error`         — rings the phone
 *   2. category `task_complete` — rewrites the same row to COMPLETED
 *
 * Both carry the real session id, so they merge into the row moshi-hook already
 * maintains rather than opening a second one: one banner, one completed card.
 *
 * `error` is being borrowed as a carrier, which is the one dishonest part of
 * this. It costs nothing today — the pi integration never sends a real error,
 * so no genuine alert is being buried — and the failure mode if Moshi ever
 * changes the rule is silence, not damage.
 *
 * This module holds the half with no I/O: credentials, config, payload shape
 * and text. index.ts does the talking.
 */

/** Categories this extension writes. Moshi accepts six more; none are useful here. */
export type MoshiCategory = "error" | "task_complete";

/**
 * The subset of Moshi's host-event schema written here.
 *
 * The server validates against an exact union and reports the whole schema when
 * a value falls outside it; contract.test.ts pins the parts relied on, so a
 * field invented later fails locally instead of at the phone.
 */
export type MoshiEvent = {
	source: "pi";
	eventType: "stop" | "agent_turn_complete";
	category: MoshiCategory;
	sessionId: string;
	eventId: string;
	title: string;
	message: string;
	projectName?: string;
	hostName?: string;
	modelName?: string;
	contextRemaining?: number;
	terminalKind?: "herdr" | "tmux";
	herdrSession?: string;
	herdrWorkspaceId?: string;
	herdrWorkspace?: string;
	herdrPane?: string;
	herdrTabId?: string;
	tmuxSession?: string;
	tmuxWindow?: string;
	tmuxPane?: string;
	/** `none` leaves the Live Activity to moshi-hook, which is already driving it. */
	liveActivity: { action: "none" };
};

export type Config = {
	enabled: boolean;
	/** Skip turns shorter than this. 0 notifies for every turn. */
	minSeconds: number;
	/** macOS only: stay quiet while the console is unlocked, i.e. while you are at the Mac. */
	onlyWhenLocked: boolean;
	/** Send the second event that rewrites WORKING to COMPLETED. */
	fixStatus: boolean;
	/** Gap before that second event. Long enough to lose a race with it, short enough not to linger. */
	fixDelayMs: number;
};

export const DEFAULT_CONFIG: Config = {
	enabled: true,
	minSeconds: 0,
	onlyWhenLocked: false,
	fixStatus: true,
	fixDelayMs: 2000,
};

export type Credentials = { hostId: string; hostSecret: string };

/** Moshi's own field names, as written by `moshi-hook pair` into secrets.json. */
export function parseCredentials(raw: unknown): Credentials | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const record = raw as Record<string, unknown>;
	const hostId = record["host-id"];
	const hostSecret = record["host-secret"];
	if (typeof hostId !== "string" || hostId.length === 0) return undefined;
	if (typeof hostSecret !== "string" || hostSecret.length === 0) return undefined;
	return { hostId, hostSecret };
}

/** Unknown keys and wrong types fall back to the default rather than disabling the extension. */
export function parseConfig(raw: unknown): Config {
	if (!raw || typeof raw !== "object") return { ...DEFAULT_CONFIG };
	const record = raw as Record<string, unknown>;
	const bool = (key: keyof Config, fallback: boolean) =>
		typeof record[key] === "boolean" ? (record[key] as boolean) : fallback;
	const count = (key: keyof Config, fallback: number) =>
		typeof record[key] === "number" && Number.isFinite(record[key]) && (record[key] as number) >= 0
			? (record[key] as number)
			: fallback;
	return {
		enabled: bool("enabled", DEFAULT_CONFIG.enabled),
		minSeconds: count("minSeconds", DEFAULT_CONFIG.minSeconds),
		onlyWhenLocked: bool("onlyWhenLocked", DEFAULT_CONFIG.onlyWhenLocked),
		fixStatus: bool("fixStatus", DEFAULT_CONFIG.fixStatus),
		fixDelayMs: count("fixDelayMs", DEFAULT_CONFIG.fixDelayMs),
	};
}

export type TerminalRef = Pick<
	MoshiEvent,
	| "terminalKind"
	| "herdrSession"
	| "herdrWorkspaceId"
	| "herdrWorkspace"
	| "herdrPane"
	| "herdrTabId"
	| "tmuxSession"
	| "tmuxWindow"
	| "tmuxPane"
>;

/**
 * Where this turn ran, so tapping the notification lands on the pane it ran in.
 *
 * Moshi resolves these structured fields itself; the `moshi://` URL grammar is
 * for webhooks, which this does not use.
 */
export function terminalFromEnv(env: Record<string, string | undefined>): TerminalRef | undefined {
	if (env.HERDR_ENV === "1") {
		const ref: TerminalRef = { terminalKind: "herdr", herdrSession: env.HERDR_SESSION_NAME || "default" };
		if (env.HERDR_WORKSPACE_ID) ref.herdrWorkspaceId = env.HERDR_WORKSPACE_ID;
		if (env.HERDR_PANE_ID) ref.herdrPane = env.HERDR_PANE_ID;
		if (env.HERDR_TAB_ID) ref.herdrTabId = env.HERDR_TAB_ID;
		return ref;
	}
	if (env.TMUX && env.TMUX_SESSION_NAME) {
		const ref: TerminalRef = { terminalKind: "tmux", tmuxSession: env.TMUX_SESSION_NAME };
		if (env.TMUX_PANE) ref.tmuxPane = env.TMUX_PANE;
		return ref;
	}
	return undefined;
}

export type Turn = {
	sessionId: string;
	project: string;
	/** The assistant's closing words. Empty is fine; the text falls back. */
	summary: string;
	durationMs: number;
	model?: string;
	contextRemaining?: number;
	hostName?: string;
	terminal?: TerminalRef;
	/** Passed in so event ids are reproducible under test. */
	now: number;
};

const TITLE_LIMIT = 80;
const MESSAGE_LIMIT = 200;

function collapse(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

export function clamp(text: string, limit: number): string {
	if (text.length <= limit) return text;
	return `${text.slice(0, limit - 1).trimEnd()}…`;
}

/** Text of one assistant message, skipping thinking blocks and tool calls. */
export function assistantText(message: unknown): string {
	if (!message || typeof message !== "object") return "";
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return collapse(content);
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const chunk of content) {
		if (typeof chunk === "string") {
			parts.push(chunk);
			continue;
		}
		if (!chunk || typeof chunk !== "object") continue;
		const block = chunk as { type?: unknown; text?: unknown };
		// Reasoning is not for a lock screen, and a missing type means plain text.
		if (block.type !== undefined && block.type !== "text") continue;
		if (typeof block.text === "string") parts.push(block.text);
	}
	return collapse(parts.join(" "));
}

export function lastAssistantText(messages: unknown): string {
	if (!Array.isArray(messages)) return "";
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index] as { role?: unknown } | undefined;
		if (message?.role !== "assistant") continue;
		const text = assistantText(message);
		if (text) return text;
	}
	return "";
}

export function formatDuration(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		const rest = seconds % 60;
		return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
	}
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/**
 * Which field becomes the headline depends on the category, so both events
 * carry the same pair and each reads as either a headline or a label.
 */
export function eventTitle(turn: Turn): string {
	return clamp(`pi ✓ ${turn.project}`, TITLE_LIMIT);
}

export function eventMessage(turn: Turn): string {
	const suffix = turn.durationMs > 0 ? ` · ${formatDuration(turn.durationMs)}` : "";
	const body = turn.summary || "Turn finished";
	return `${clamp(body, MESSAGE_LIMIT - suffix.length)}${suffix}`;
}

export function shouldNotify(turn: Turn, config: Config, consoleLocked: boolean | undefined): boolean {
	if (!config.enabled) return false;
	if (turn.durationMs < config.minSeconds * 1000) return false;
	// An unreadable lock state keeps the notification: silence should never be
	// the accident. Same rule moshi-hook applies to its own suppression.
	if (config.onlyWhenLocked && consoleLocked === false) return false;
	return true;
}

/** The ringing event first, then the one that corrects the card. */
export function buildEvents(turn: Turn, config: Config): MoshiEvent[] {
	const base = {
		source: "pi",
		sessionId: turn.sessionId,
		title: eventTitle(turn),
		message: eventMessage(turn),
		liveActivity: { action: "none" },
		...(turn.project ? { projectName: turn.project } : {}),
		...(turn.hostName ? { hostName: turn.hostName } : {}),
		...(turn.model ? { modelName: turn.model } : {}),
		...(typeof turn.contextRemaining === "number"
			? { contextRemaining: Math.max(0, Math.min(100, Math.round(turn.contextRemaining))) }
			: {}),
		...(turn.terminal ?? {}),
	} satisfies Omit<MoshiEvent, "eventType" | "category" | "eventId">;

	const ring: MoshiEvent = {
		...base,
		eventType: "stop",
		category: "error",
		eventId: `pi-${turn.sessionId}-${turn.now}`,
	};
	if (!config.fixStatus) return [ring];

	const settle: MoshiEvent = {
		...base,
		eventType: "agent_turn_complete",
		category: "task_complete",
		eventId: `pi-${turn.sessionId}-${turn.now}-done`,
	};
	return [ring, settle];
}

export function eventsUrl(hostId: string): string {
	return `https://api.getmoshi.app/api/v1/hosts/${encodeURIComponent(hostId)}/events`;
}
