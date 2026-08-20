/**
 * The bash feature: give the command line the layers pi's other titles have.
 *
 * Six of pi's seven tools set their title as a bold verb, an accent object and
 * a muted modifier. bash puts the whole command in one colour and bolds it end
 * to end, which is why a long pipeline is hard to read and why a heredoc turns
 * into several bold lines. This restores the layering by colouring the parts
 * the grammar names, and bolds only the prompt.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";

import type { RenderArgs, RenderContext } from "../tools/builtins.ts";
import { tokenize, type Piece } from "./engine.ts";

/** Strip SGR sequences, to compare what will be shown against what will run. */
const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "");

/** Paint pieces with the active theme. Untokenised runs keep the title colour. */
export function paint(pieces: readonly Piece[], theme: Theme): string {
	return pieces
		.map(({ text, token }) => (token && text.trim() ? theme.fg(token as never, text) : text))
		.join("");
}

/**
 * The title for a command, or undefined to leave pi's alone.
 *
 * Undefined is returned whenever anything is unusual — no command, the
 * highlighter unavailable, or pieces that do not reassemble into the original.
 * Falling back to pi costs colour; showing an altered command costs trust.
 */
export function title(command: string, theme: Theme): string | undefined {
	if (!command) return undefined;
	const pieces = tokenize(command);
	if (!pieces) return undefined;
	if (pieces.map((piece) => piece.text).join("") !== command) return undefined;

	const prompt = theme.fg("toolTitle" as never, theme.bold("$"));
	const body = paint(pieces, theme);
	const rendered = `${prompt} ${body}`;
	// Cheap belt and braces: the painted string must still read as the command.
	return plain(rendered) === `$ ${command}` ? rendered : undefined;
}

/**
 * A Presentation.retitle for bash.
 *
 * pi renders the command across as many lines as it has; this replaces the
 * whole run, so the caller must hand over every line the built-in produced.
 */
export function retitling() {
	return (lines: string[], args: RenderArgs, theme: Theme, _context: RenderContext): string[] | undefined => {
		const command = (args as { command?: unknown }).command;
		if (typeof command !== "string") return undefined;
		const styled = title(command, theme);
		if (styled === undefined) return undefined;
		const replacement = styled.split("\n");
		// pi wraps long lines; if it produced more lines than the command has,
		// its wrapping is doing work this cannot reproduce, so leave it alone.
		return replacement.length === lines.length ? replacement : undefined;
	};
}
