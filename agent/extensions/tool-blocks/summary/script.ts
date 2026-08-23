/**
 * Which writing system a piece of text is in.
 *
 * Not a language detector. Telling Spanish from English is what a detector
 * cannot do -- counting CJK characters calls Spanish, French, German and Russian
 * all English -- and it is why the writer is asked for the language rather than
 * told it.
 *
 * This asks a smaller question with a certain answer: is the sentence written in
 * the same script as the reader's own words. A summary in Hangul under a session
 * held in English is the failure that shows, and it shows because the alphabet
 * changed. Two languages sharing an alphabet are not separated here, and are not
 * meant to be: nothing about that case is jarring enough to spend a request on.
 *
 * Measured on the block that raised it: over sixty sentences the writer produced
 * five in a script the reader had not used, and asked again, all five came back
 * in the reader's own. Wording could not reach it -- four phrasings of the rule
 * ran 1, 2, 2 and 11 out of 40, the differences inside the noise except for the
 * one that made it worse.
 */

/**
 * Scripts that settle the question on sight, in the order they are checked.
 *
 * Kana and Hangul belong to one language each, and Japanese writes Han
 * characters alongside kana -- more of them than kana, usually. Counting which
 * appears most would read a Japanese sentence as Han, so a single kana decides
 * it before the counting starts.
 */
const DECISIVE: readonly [string, RegExp][] = [
	["kana", /[\u3040-\u30ff]/],
	["hangul", /[\uac00-\ud7af\u1100-\u11ff]/],
];

/** The rest, told apart by which appears most. */
const SCRIPTS: readonly [string, RegExp][] = [
	["han", /[\u4e00-\u9fff\u3400-\u4dbf]/g],
	["cyrillic", /[\u0400-\u04ff]/g],
	["arabic", /[\u0600-\u06ff]/g],
	["hebrew", /[\u0590-\u05ff]/g],
	["thai", /[\u0e00-\u0e7f]/g],
	["devanagari", /[\u0900-\u097f]/g],
	["greek", /[\u0370-\u03ff]/g],
];

/**
 * The script a text is written in, or undefined when there is nothing to tell.
 *
 * Latin is the answer when no other script appears in it, so a sentence naming
 * files and flags in a session held in Japanese still reads as Japanese: kana in
 * the prose outweighs the identifiers, which are Latin in every language.
 */
export function scriptOf(text: string): string | undefined {
	const letters = text.replace(/[^\p{L}]/gu, "");
	if (letters.length === 0) return undefined;
	for (const [name, pattern] of DECISIVE) {
		if (pattern.test(text)) return name;
	}
	let best: { name: string; count: number } | undefined;
	for (const [name, pattern] of SCRIPTS) {
		const count = (text.match(pattern) ?? []).length;
		if (count > 0 && (best === undefined || count > best.count)) best = { name, count };
	}
	return best?.name ?? "latin";
}

/**
 * True when a sentence is written in a different script from the reader's own.
 *
 * Undefined on either side means there is nothing to compare, which is not a
 * mismatch: a sentence made only of a path has no script, and a session with
 * nothing said in it has no reader to match.
 */
export function driftedFrom(sample: string, sentence: string): boolean {
	const wanted = scriptOf(sample);
	const got = scriptOf(sentence);
	return wanted !== undefined && got !== undefined && wanted !== got;
}
