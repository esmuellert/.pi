/**
 * TextMate scope to pi theme token.
 *
 * Scopes are hierarchical — `keyword.operator.pipe.shell` — so this matches on
 * prefixes rather than enumerating them. A grammar that grows a new scope lands
 * on its parent instead of falling out, and the table stays the size of the
 * ideas rather than the size of the grammar.
 *
 * The tokens are pi's own, so this is a mapping between two vocabularies and
 * never a colour: the active theme decides what `syntaxFunction` looks like,
 * and a new theme needs no change here.
 */

/** A pi theme token, as a string because pi does not export the union for these. */
export type ThemeToken = string;

/**
 * Longest prefix wins, so the order here is only for reading; `match` sorts.
 * Measured against 190 real commands from a working session.
 */
export const SCOPE_TOKENS: ReadonlyArray<readonly [string, ThemeToken]> = [
	// The command itself, and what stands in for it.
	["entity.name.command", "syntaxFunction"],
	["support.function", "syntaxKeyword"], // builtins: cd, echo, export
	["keyword.control", "syntaxKeyword"], // if, for, while, do, done

	// What modifies it.
	["constant.other.option", "syntaxNumber"], // -la, --include
	["keyword.operator", "syntaxOperator"], // |, <<, redirects
	["punctuation.separator.statement", "syntaxOperator"], // &&, ;
	["punctuation.definition.subshell", "syntaxOperator"],
	["punctuation.section", "syntaxOperator"],

	// Data.
	["string.quoted.heredoc", "mdCodeBlock"], // a heredoc body is not shell
	["punctuation.definition.string", "syntaxString"],
	["string", "syntaxString"],
	["variable", "syntaxVariable"],
	["constant.numeric", "syntaxNumber"],
	["comment", "syntaxComment"],

	// Everything the grammar reached but did not classify is an argument, which
	// is the object of the command and so takes the object colour.
	["meta.argument", "accent"],
	["meta.statement", "accent"],
];

const BY_LENGTH = [...SCOPE_TOKENS].sort((a, b) => b[0].length - a[0].length);

/** The token for a scope, or undefined when nothing claims it. */
export function tokenForScope(scope: string): ThemeToken | undefined {
	return BY_LENGTH.find(([prefix]) => scope.startsWith(prefix))?.[1];
}

/**
 * The token for a scope stack, innermost first.
 *
 * TextMate nests scopes, so a string inside a heredoc carries both. The
 * innermost scope that anything claims wins, which is what makes
 * `string.quoted.heredoc` beat the `string` it also matches.
 */
export function tokenForStack(scopes: readonly string[]): ThemeToken | undefined {
	for (let i = scopes.length - 1; i >= 0; i -= 1) {
		const token = tokenForScope(scopes[i]!);
		if (token) return token;
	}
	return undefined;
}
