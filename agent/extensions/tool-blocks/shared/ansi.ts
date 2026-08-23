/**
 * Reading text that carries SGR sequences.
 *
 * Three places needed the same "what would this look like without colour"
 * question answered, and each had written the pattern out again. A regex
 * repeated is a regex that drifts.
 *
 * pi-tui's `visibleWidth` answers the width question and is used directly
 * wherever that is what is wanted; this is for the cases that need the text.
 */

const SGR = /\u001b\[[0-9;]*m/g;

/** The text as it would read with no colour applied. */
export const plain = (text: string): string => text.replace(SGR, "");

/** True when a line carries no visible text, whatever colour it is painted. */
export const blank = (line: string): boolean => plain(line).trim() === "";

/**
 * The background a line opens with, as the sequence that sets it.
 *
 * Returned rather than computed, because which background a tool block wears
 * is the tool's business and not a rule anyone else can restate. pi picks
 * pending, success or error from two flags -- but `edit` overrides that with
 * its own choice, using the pending background for a settled edit. Reading the
 * line is right for every tool, in every state, including ones not written yet.
 *
 * Only the leading run is read: what a line does after its first character is
 * about the line, not about the margin in front of it.
 */
export function openingBackground(line: string): string | undefined {
	const leading = /^(?:\u001b\[[0-9;]*m)+/.exec(line)?.[0];
	if (!leading) return undefined;
	// The last background wins, as the terminal would have it.
	let found: string | undefined;
	for (const sequence of leading.matchAll(/\u001b\[([0-9;]*)m/g)) {
		const first = Number(sequence[1]!.split(";")[0]);
		// 40-47 and 100-107 are the palette backgrounds; 48 opens an extended
		// one, whose parameters follow in the same sequence. 49 resets.
		if ((first >= 40 && first <= 49) || (first >= 100 && first <= 107)) found = sequence[0];
	}
	return found;
}

/**
 * Turn a full reset into a foreground-only one.
 *
 * pi-tui's `truncateToWidth` closes what it cut with `\u001b[0m`, which clears
 * the background as well as the colour. A tool block's background is painted
 * once at the start of the line by the Box around it, so everything after that
 * reset -- the ellipsis, and whatever is appended after it -- draws on the
 * terminal's own background instead of the block's, as a dark band to the right
 * edge.
 *
 * `39` closes the foreground and leaves the background alone, which is what was
 * meant.
 */
export const keepBackground = (text: string): string => text.replaceAll("\u001b[0m", "\u001b[39m");
