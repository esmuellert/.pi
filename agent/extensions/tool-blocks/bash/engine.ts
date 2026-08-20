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
 * pipe no longer distinguishable.
 */
const THEME = "nord";

export async function prepare(): Promise<boolean> {
	if (highlighter) return true;
	try {
		const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, bash, theme] = await Promise.all([
			import("shiki/core"),
			import("shiki/engine/javascript"),
			import("@shikijs/langs/bash"),
			import("@shikijs/themes/nord"),
		]);
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
export function tokenize(command: string): Piece[] | undefined {
	if (!highlighter) return undefined;
	try {
		const { tokens } = highlighter.codeToTokens(command, {
			lang: "bash",
			theme: THEME,
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
