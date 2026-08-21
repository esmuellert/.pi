/**
 * Deciding whether an insertion needs a space in front of it.
 *
 * Kept apart from the wiring so it can be tested without an editor.
 */

/** What the editor looked like at the moment of an insertion. */
export type At = {
	/** Everything before the cursor. */
	readonly before: string;
	/** Everything after it. */
	readonly after: string;
};

/**
 * Whether `text` would run into what is already there.
 *
 * Only whitespace separates two things in an editor, so the test is whether
 * there is any. Neither side is inspected for what it contains: a path, a word
 * and a sentence all need the same gap, and guessing which is which is how a
 * rule like this starts mangling ordinary typing.
 *
 * The start of a line needs nothing, and neither does an insertion that
 * already carries its own space.
 */
export function needsSpaceBefore(text: string, at: At): boolean {
	if (!text || /^\s/.test(text)) return false;
	if (at.before === "") return false;
	return !/\s$/.test(at.before);
}

/** The same question for the far end, so the next thing typed does not stick. */
export function needsSpaceAfter(text: string, at: At): boolean {
	if (!text || /\s$/.test(text)) return false;
	if (at.after === "") return false;
	return !/^\s/.test(at.after);
}

/** `text` with whatever spacing it needs where it is going. */
export function separated(text: string, at: At): string {
	if (!text) return text;
	return (needsSpaceBefore(text, at) ? " " : "") + text + (needsSpaceAfter(text, at) ? " " : "");
}
