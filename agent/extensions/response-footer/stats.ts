/**
 * What a reply cost, gathered while it runs.
 *
 * One reply is many turns: pi emits turn_start/turn_end per model call, and a
 * reply in this session runs four of them at the median and 113 at the worst.
 * So the tally spans agent_start to agent_end, not one turn.
 */

/** What is stored per reply. Fields may be added; renaming one drops it from every entry already written. */
export interface Stats {
	tools: number;
	ms: number;
	/** Everything sent: fresh tokens plus both halves of the cache. */
	tokensIn: number;
	tokensOut: number;
	/** Share of the sent tokens that came from cache, 0-1. */
	cacheHit: number | null;
	cost: number;
}

/** Usage as pi reports it on an assistant message. */
export interface Usage {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: number | { total?: number };
}

/** A running tally, reset when a reply starts. */
export interface Tally {
	startedAt: number;
	tools: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export const empty = (now: number): Tally => ({
	startedAt: now, tools: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0,
});

/** Fold one assistant message's usage into the tally. */
export function add(tally: Tally, usage: Usage | undefined, toolCalls: number): void {
	tally.tools += toolCalls;
	if (!usage) return;
	tally.input += usage.input ?? 0;
	tally.output += usage.output ?? 0;
	tally.cacheRead += usage.cacheRead ?? 0;
	tally.cacheWrite += usage.cacheWrite ?? 0;
	tally.cost += typeof usage.cost === "number" ? usage.cost : (usage.cost?.total ?? 0);
}

/**
 * Close the tally.
 *
 * `tokensIn` is everything sent, cache included, because that is what a request
 * carries -- the whole context goes over on every turn. Charging it as "new"
 * would read as a leak; leaving it out would hide why a reply cost what it did.
 * The hit rate is what separates the two, and it is what moves the bill: a reply
 * that misses the cache costs several times one that does not.
 */
export function close(tally: Tally, now: number): Stats {
	const sent = tally.input + tally.cacheRead + tally.cacheWrite;
	return {
		tools: tally.tools,
		ms: Math.max(0, now - tally.startedAt),
		tokensIn: sent,
		tokensOut: tally.output,
		cacheHit: sent > 0 ? tally.cacheRead / sent : null,
		cost: tally.cost,
	};
}

/** True when a reply did enough to be worth a line. */
export const worthShowing = (s: Stats): boolean => s.tools > 0 || s.cost > 0 || s.tokensOut > 0;
