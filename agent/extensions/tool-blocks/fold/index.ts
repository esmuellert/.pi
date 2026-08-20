/**
 * The fold feature: show a long command as one line until it is asked for.
 *
 * Half of the commands in this session's history run to several lines, and the
 * single-line ones are no shorter -- 28 of 30 wrap at eighty columns, the
 * longest to eleven lines. So the unit that matters is rendered lines, not
 * source lines: a title is folded when it does not fit on one.
 *
 * pi already has the control this needs. ctrl+o toggles `context.expanded`,
 * which the built-in `read` tool uses for exactly this, and `write` for its
 * preview. Folding the command joins that switch rather than inventing one.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { resolve } from "node:path";

/**
 * How much is hidden. Change this line to change every folded title.
 *
 * Naming the unit costs six columns over a bare "+47", and the unit is
 * derivable -- a folded title can only be hiding lines. It is named anyway:
 * a bare number beside a command reads as part of it, and the point of the
 * layered colouring this sits on is that the eye should not have to work out
 * where the command ends.
 *
 * Two shorter forms were weighed and dropped. "… +47" spends a column on a
 * mark that says what "+47" already says, and a bare "…" drops the number,
 * which is the only thing worth knowing.
 */
const format = (hidden: number) => ` +${hidden} lines`;

export function hint(hidden: number, theme: Theme): string {
	return theme.fg("dim", format(hidden));
}

/**
 * Drop a leading `cd <path> &&` when it names the directory the command would
 * run in anyway.
 *
 * It opens 70% of the commands here and costs a median of 34 columns, which at
 * a narrow width is the whole line: `cd /home/dev/repos/atlas && cat >`
 * fills eighty columns without saying which file is being written.
 *
 * Only the redundant case is dropped. A `cd` somewhere else changes what the
 * command does, and anything that changes meaning stays.
 */
export function withoutRedundantCd(command: string, cwd: string): string {
	const match = /^cd\s+("[^"]*"|'[^']*'|[^\s&|;]+)\s*&&\s*/.exec(command);
	if (!match) return command;
	const raw = match[1]!.replace(/^["']|["']$/g, "");
	const path = raw.startsWith("~") ? (process.env.HOME ?? "") + raw.slice(1) : raw;
	if (!path) return command;
	try {
		return resolve(path) === resolve(cwd) ? command.slice(match[0]!.length) : command;
	} catch {
		return command;
	}
}

/**
 * One line, or the lines unchanged if they already are one.
 *
 * The head is taken from the command rather than from the rendered lines,
 * because the first rendered line ends wherever the wrap fell -- which is how
 * `cat >` loses its filename. Painting the head separately keeps the argument.
 */
export function fold(
	lines: string[],
	head: string,
	width: number,
	theme: Theme,
): string[] {
	if (lines.length <= 1) return lines;
	const tag = hint(lines.length - 1, theme);
	const room = width - visibleWidth(tag);
	if (room < 1) return lines;
	const first = wrapTextWithAnsi(head, room)[0] ?? "";
	return [truncateToWidth(first, room) + tag];
}
