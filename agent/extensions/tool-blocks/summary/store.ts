/**
 * Sentences that outlive the render they were written for.
 *
 * A summary lived only in `context.state`, which pi keeps per rendered row. Both
 * `/reload` and reopening a session call `rebuildChatFromMessages`, which clears
 * the chat container and builds every row again -- so the state went with it and
 * every visible block asked for its sentence a second time. pi renders the whole
 * transcript and slices the viewport out of the result afterwards, so "visible"
 * means all of it: 194 blocks past the last compaction in the session this was
 * written in, and 194 requests each time.
 *
 * They are kept as pi's own custom entries. `appendEntry` writes one into the
 * session file, and `sessionEntryToContextMessages` returns nothing for the
 * `custom` type -- so they survive a restart and never reach the model. Checked
 * rather than assumed: an entry written in one run was read back in the next,
 * and the messages of the `context` event did not contain it.
 *
 * The key is the tool call's id. A hash of the command would share one sentence
 * between two runs of the same command, which are two different things having
 * happened; the id is what pi already calls one block.
 */

export const ENTRY_TYPE = "tool-block-summary";

/** What one remembered sentence looks like in the session file. */
export interface Remembered {
	id: string;
	text: string;
}

/** Just enough of pi's session manager to read entries back. */
export interface Branch {
	getBranch: () => readonly { type?: string; customType?: string; data?: unknown }[];
}

/** Just enough of pi's extension api to write one. */
export interface Appender {
	appendEntry: (customType: string, data: unknown) => void;
}

let remembered = new Map<string, string>();
let appender: Appender | undefined;

/** Load what a session already knows, and take the means to add to it. */
export function useSession(append: Appender | undefined, branch: Branch | undefined): void {
	appender = append;
	remembered = read(branch);
}

/** Every sentence a session has stored, latest wins. */
export function read(branch: Branch | undefined): Map<string, string> {
	const found = new Map<string, string>();
	for (const entry of branch?.getBranch?.() ?? []) {
		if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
		const data = entry.data as Partial<Remembered> | undefined;
		if (typeof data?.id === "string" && typeof data.text === "string") found.set(data.id, data.text);
	}
	return found;
}

/** The sentence stored for a block, if one was. */
export function recall(id: string | undefined): string | undefined {
	return id === undefined ? undefined : remembered.get(id);
}

/**
 * Store a sentence for a block.
 *
 * Held in memory as well as written, so a block that renders again in this run
 * does not wait for the file. A failure to write is a sentence that gets asked
 * for again next time, which is what happened before this existed.
 */
export function remember(id: string | undefined, text: string): void {
	if (id === undefined) return;
	remembered.set(id, text);
	try {
		appender?.appendEntry(ENTRY_TYPE, { id, text } satisfies Remembered);
	} catch {
		// pi rejects a write from an extension that is no longer active.
	}
}

/** Forget everything. For tests, which must not see each other's sentences. */
export function forget(): void {
	remembered = new Map();
	appender = undefined;
}
