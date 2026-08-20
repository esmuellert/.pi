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
 * Ways to say how much is hidden, in the dimmest colour the theme has.
 *
 * All of them cost columns the command could have used, so the shortest that
 * still answers "how much am I not seeing" wins. `plain` gives no number and
 * is here to show what that costs.
 */
export const HINTS = {
	count: (hidden: number) => ` +${hidden}`,
	ellipsis: (hidden: number) => ` … +${hidden}`,
	lines: (hidden: number) => ` +${hidden} lines`,
	plain: () => " …",
} as const;

export type HintStyle = keyof typeof HINTS;

export function hint(hidden: number, theme: Theme, style: HintStyle = "count"): string {
	return theme.fg("dim", HINTS[style](hidden));
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
	style: HintStyle = "count",
): string[] {
	if (lines.length <= 1) return lines;
	const tag = hint(lines.length - 1, theme, style);
	const room = width - visibleWidth(tag);
	if (room < 1) return lines;
	const first = wrapTextWithAnsi(head, room)[0] ?? "";
	return [truncateToWidth(first, room) + tag];
}
