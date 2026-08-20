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
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

import { blank, plain } from "../shared/ansi.ts";
import type { RenderArgs, RenderContext } from "../tools/builtins.ts";
import { tokenize, type Piece } from "./engine.ts";



/**
 * Paint pieces with the active theme, one escape sequence per run of colour.
 *
 * The grammar splits finely — a quoted argument arrives as quote, body, quote —
 * and painting each piece separately puts three identical colour changes where
 * one would do. A command line came out with forty escape sequences against the
 * four pi uses for the same title, which some terminals render and some do not.
 * Merging neighbours that share a token is both smaller and closer to what pi
 * itself emits.
 *
 * Whitespace never carries colour of its own, so it joins whichever run it sits
 * in rather than breaking it.
 */
export function paint(pieces: readonly Piece[], theme: Theme): string {
	const runs: { token: string | undefined; text: string }[] = [];
	for (const { text, token } of pieces) {
		// A blank piece extends the run it follows, whatever that run is.
		const carried = text.trim() ? token : runs.at(-1)?.token;
		const open = runs.at(-1);
		if (open && open.token === carried) open.text += text;
		else runs.push({ token: carried, text });
	}
	return runs
		.map(({ token, text }) => (token && text.trim() ? theme.fg(token as never, text) : text))
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
 * The width has to be honoured here rather than deferred to pi. pi's Text
 * wraps the title to the pane, so at any width where the command does not fit
 * it hands over more lines than the command has, and a replacement that has
 * not wrapped cannot stand in for them. Comparing the counts and giving up was
 * the first attempt, and it meant the highlighting simply vanished on a narrow
 * pane — visible on a phone, and on a desktop as soon as the window narrowed.
 *
 * `wrapTextWithAnsi` is the function pi's own Text wraps with, so the result
 * breaks in the same places pi would have broken it, and reopens the colour on
 * the far side of a break.
 *
 * The width is passed in rather than inferred. Reading it back off the longest
 * line pi produced looked adequate and is not: word wrapping leaves lines
 * short of the width, by five columns in the fixtures, so the replacement
 * would wrap tighter than pi did.
 */
/** What a cached title was made from. Anything else and it must be made again. */
type Cached = {
	command: string;
	width: number;
	theme: Theme;
	lines: string[] | undefined;
};

const CACHE = "__toolBlocksBashTitle";

export function retitling() {
	return (_lines: string[], width: number, args: RenderArgs, theme: Theme, context: RenderContext): string[] | undefined => {
		const command = (args as { command?: unknown }).command;
		if (typeof command !== "string") return undefined;

		// Every block re-renders on every frame, so this runs once per bash block
		// per keystroke. Tokenising is half a millisecond, which is nothing until
		// a session holds eight hundred of them and every frame costs two thirds
		// of a second. pi's own bash renderer caches for the same reason.
		//
		// The theme is part of the key because /theme repaints without changing
		// the command or the width.
		const state = context.state as Record<string, unknown>;
		const cached = state[CACHE] as Cached | undefined;
		if (cached && cached.command === command && cached.width === width && cached.theme === theme) {
			return cached.lines;
		}

		const lines = build(command, width, theme);
		state[CACHE] = { command, width, theme, lines } satisfies Cached;
		return lines;
	};
}

function build(command: string, width: number, theme: Theme): string[] | undefined {
	const styled = title(command, theme);
	if (styled === undefined) return undefined;
	// wrapTextWithAnsi is undefined below one column, which is the only case
	// there is nothing sensible to return for.
	if (width < 1) return undefined;
	const wrapped = styled.split("\n").flatMap((line) => unpad(wrapTextWithAnsi(line, width)));
	return wrapped.length > 0 ? wrapped : undefined;
}

/**
 * Drop the blank lines wrapping invents around a colour change.
 *
 * pi-tui's wrapTextWithAnsi breaks the same visible text differently depending
 * on whether it carries SGR: where a styled word lands on the boundary it
 * emits an empty line that the unstyled text does not get. Nothing else here
 * produces a blank line — the command's own blank lines arrive as separate
 * segments — so dropping them is safe and keeps the break points matching what
 * pi would have shown.
 */
function unpad(lines: readonly string[]): string[] {
	return lines.filter((line, index) => index === 0 || !blank(line));
}

