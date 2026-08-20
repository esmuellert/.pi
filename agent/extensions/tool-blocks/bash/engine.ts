/**
 * Tokenising a command line with VS Code's shell grammar.
 *
 * pi highlights through highlight.js, whose bash grammar is written for script
 * files. Measured over 190 real commands it colours about a tenth of the
 * characters and recognises none of the parts a reader scans for: not the
 * command, not its options, not the pipes. The TextMate grammar reaches 98% and
 * names all of them, and understands heredocs, where the body is not shell at
 * all and a `;` inside it is not an operator.
 *
 * Setup is async and pi's renderCall is not, so the highlighter is prepared
 * once when the extension loads and used synchronously afterwards. Until it is
 * ready, and if it never becomes ready, `tokenize` returns undefined and the
 * caller leaves pi's own rendering alone.
 */

import { tokenForStack, type ThemeToken } from "./scopes.ts";

/** A run of text and the pi theme token it should take. */
export type Piece = {
	readonly text: string;
	readonly token: ThemeToken | undefined;
};

type Highlighter = {
	codeToTokens: (
		code: string,
		options: { lang: string; theme: string; includeExplanation: "scopeName" },
	) => { tokens: { content: string; explanation?: { scopes: { scopeName: string }[] }[] }[][] };
};

let highlighter: Highlighter | undefined;
let failure: unknown;

/**
 * A theme must be loaded even though none of its colours are used: without one
 * shiki merges adjacent tokens, and `| grep ` arrives as a single run with the
 * pipe no longer distinguishable. Which theme is immaterial, so the name is
 * read from whatever was imported rather than repeated as a string that could
 * come to disagree with the import above it.
 */
let themeName: string | undefined;

export async function prepare(): Promise<boolean> {
	if (highlighter) return true;
	try {
		const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, bash, theme] = await Promise.all([
			import("shiki/core"),
			import("shiki/engine/javascript"),
			import("@shikijs/langs/bash"),
			import("@shikijs/themes/nord"),
		]);
		// Themes ship either as a registration or an array of them.
		const registrations = ([] as { name?: string }[]).concat(theme.default as never);
		themeName = registrations[0]?.name;
		if (!themeName) return false;
		highlighter = (await createHighlighterCore({
			themes: [theme],
			langs: [bash],
			// The WebAssembly engine is more faithful but this grammar does not
			// need it, and it costs a megabyte and an async load.
			engine: createJavaScriptRegexEngine(),
		})) as unknown as Highlighter;
		return true;
	} catch (error) {
		failure = error;
		return false;
	}
}

/** The grammar this feature tokenises with, named once. */
const LANGUAGE = "bash";

export const ready = () => highlighter !== undefined;
export const lastFailure = () => failure;

/**
 * Split a command into pieces carrying pi theme tokens, or undefined when the
 * highlighter is not available.
 *
 * The pieces always reassemble into the original command. A highlighter that
 * alters the text shows something other than what ran, so `render` checks this
 * and falls back rather than trusting it.
 */
/**
 * Tokenising is the expensive part and depends on nothing but the command.
 *
 * Every block re-tokenised on every frame cost two thirds of a second in a
 * session holding eight hundred of them; the same commands recur, and a
 * command's pieces never change. Held per tool row would still re-tokenise on
 * a width change, which is when the cost is most visible, so the cache is
 * keyed on the command itself.
 *
 * Bounded because a long session's commands are unbounded. Least-recently-used
 * is not worth the bookkeeping here: dropping the oldest half keeps the recent
 * ones, which are the ones on screen.
 */
const CACHE_LIMIT = 2048;
const cache = new Map<string, Piece[] | undefined>();

export function tokenize(command: string): Piece[] | undefined {
	if (!highlighter) return undefined;
	if (cache.has(command)) return cache.get(command);
	const pieces = tokenizeUncached(command);
	if (cache.size >= CACHE_LIMIT) {
		for (const key of [...cache.keys()].slice(0, Math.floor(CACHE_LIMIT / 2))) cache.delete(key);
	}
	cache.set(command, pieces);
	return pieces;
}

/** Discard everything remembered, for tests that need a cold path. */
export function forget(): void {
	cache.clear();
}

function tokenizeUncached(command: string): Piece[] | undefined {
	if (!highlighter) return undefined;
	try {
		const { tokens } = highlighter.codeToTokens(command, {
			lang: LANGUAGE,
			theme: themeName!,
			includeExplanation: "scopeName",
		});
		const pieces: Piece[] = [];
		tokens.forEach((line, index) => {
			if (index > 0) pieces.push({ text: "\n", token: undefined });
			for (const token of line) {
				const scopes = (token.explanation?.[0]?.scopes ?? []).map((scope) => scope.scopeName);
				pieces.push({ text: token.content, token: tokenForStack(scopes) });
			}
		});
		return pieces;
	} catch {
		return undefined;
	}
}
