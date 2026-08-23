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
 * `0` resets every attribute; these are the same resets with the background
 * left alone. Foreground, then intensity, italic, underline, blink, inverse and
 * strikethrough -- the closing parameter for each attribute `0` would have
 * cleared, minus `49`.
 */
const RESET_BUT_BACKGROUND = ["39", "22", "23", "24", "25", "27", "29"];

/**
 * Split an SGR parameter list into attributes.
 *
 * Parameters are not independent: `38`, `48` and `58` open an extended colour
 * and swallow what follows -- `5` and one index, or `2` and three channels. So
 * `38;2;49;116;143` is one attribute whose red channel happens to be 49, and
 * reading it parameter by parameter would find a background reset inside a
 * syntax colour.
 */
function attributes(params: string[]): string[][] {
	/** How many parameters one attribute occupies, counting its own. */
	const span = (code: number, kind: number): number => {
		if (code !== 38 && code !== 48 && code !== 58) return 1;
		// `2` introduces three channels and `5` a single palette index.
		return kind === 2 ? 5 : kind === 5 ? 3 : 1;
	};

	const out: string[][] = [];
	for (let i = 0; i < params.length; ) {
		const code = Number(params[i]);
		out.push(params.slice(i, i + span(code, Number(params[i + 1]))));
		i += span(code, Number(params[i + 1]));
	}
	return out;
}

/**
 * Rewrite the sequences in a line that would clear its background.
 *
 * A background is opened once, at the start of the line, by the Box a tool
 * block sits in. Anything mid-line that closes it takes the rest of the line
 * with it, which draws as a dark band out to the right edge.
 *
 * Two attributes close a background: `0`, which resets everything, and `49`,
 * which resets the background alone. An empty parameter list means `0`. Each is
 * replaced by what it would have done to everything else, so a sequence keeps
 * the rest of its meaning.
 *
 * Written against the SGR grammar rather than against any one library's output:
 * pi-tui's `truncateToWidth` closes a cut with `\u001b[0m` today, but
 * `\u001b[m` and `\u001b[0;1m` mean the same thing, and pi's own `theme.bg`
 * ends with `\u001b[49m`.
 */
export function keepBackground(text: string): string {
	return text.replace(SGR, (sequence) => {
		const body = sequence.slice(2, -1);
		const parsed = attributes(body === "" ? ["0"] : body.split(";"));
		const kept = parsed.flatMap((attribute) => {
			const code = Number(attribute[0]);
			if (attribute.length > 1) return [attribute];
			if (code === 0) return [RESET_BUT_BACKGROUND];
			if (code === 49) return [];
			return [attribute];
		});
		if (kept.length === parsed.length && kept.every((a, i) => a === parsed[i])) return sequence;
		const flat = kept.flat();
		return flat.length === 0 ? "" : `\u001b[${flat.join(";")}m`;
	});
}
