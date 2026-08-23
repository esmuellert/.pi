/**
 * How many sentences may be asked for at once.
 *
 * Nothing throttled them before. A rebuilt transcript renders every block, so
 * opening a session with no stored sentences fired one request per block at the
 * same instant -- 194 of them in the session this was written in, measured at 50
 * in flight out of 50 blocks. A rate limit reached that way is not a delay: a
 * refused request is recorded as a failure and not asked for again in that run,
 * so those blocks stay blank until the next.
 *
 * Five is chosen, not derived. What a provider will accept depends on the
 * account and the hour, and a number read from a failure is a number that
 * changes under you. Five keeps a normal turn -- one to three tools -- from ever
 * waiting, and turns an opening burst into a queue that drains in about a
 * minute, each sentence appearing as it lands.
 */
export const LIMIT = 5;

let live = 0;
const waiting: (() => void)[] = [];

/**
 * Run `work` once there is room, in the order asked.
 *
 * The slot is released in `finally`, so a request that throws does not take the
 * queue with it.
 */
export async function through<T>(work: () => Promise<T>): Promise<T> {
	if (live >= LIMIT) await new Promise<void>((admit) => waiting.push(admit));
	live += 1;
	try {
		return await work();
	} finally {
		live -= 1;
		waiting.shift()?.();
	}
}

/** How many are running and how many are queued. For tests. */
export function pressure(): { live: number; queued: number } {
	return { live, queued: waiting.length };
}

/** Let every waiter through. For tests, which must not inherit a full queue. */
export function drain(): void {
	live = 0;
	while (waiting.length > 0) waiting.shift()?.();
}
