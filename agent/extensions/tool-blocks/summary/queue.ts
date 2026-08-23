/**
 * How many sentences may be asked for at once, and which ones first.
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
const stack: (() => void)[] = [];

/**
 * Run `work`, newest first, five at a time.
 *
 * Everything goes on the stack, including the first request while the gate is
 * wide open. That is the whole point: a transcript renders top to bottom in one
 * synchronous pass, so admitting each caller as it arrives hands the first five
 * slots to the five oldest blocks -- the ones scrolled off the top -- before any
 * of the rest have asked. Pushing first and starting on the next microtask means
 * the whole pass is on the stack before anything runs, and the block at the
 * bottom of the transcript, the one being looked at, is served first.
 *
 * A block that finishes later lands on top of the backlog, ahead of it, for the
 * same reason.
 */
export function through<T>(work: () => Promise<T>): Promise<T> {
	return new Promise<T>((settle, fail) => {
		stack.push(() => {
			void work().then(settle, fail).finally(release);
		});
		// After the synchronous caller, so a whole render pass is on the stack
		// before the first item is taken off it.
		queueMicrotask(pump);
	});
}

/** Give a slot back and start whatever is on top. */
function release(): void {
	live -= 1;
	pump();
}

/** Start as many as there is room for, from the top. */
function pump(): void {
	while (live < LIMIT && stack.length > 0) {
		live += 1;
		stack.pop()?.();
	}
}

/** How many are running and how many are waiting. For tests. */
export function pressure(): { live: number; waiting: number } {
	return { live, waiting: stack.length };
}

/** Drop everything. For tests, which must not inherit each other's backlog. */
export function forgetQueue(): void {
	live = 0;
	stack.length = 0;
}
