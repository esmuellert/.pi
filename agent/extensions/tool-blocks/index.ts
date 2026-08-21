/**
 * Presentation for pi's tool blocks.
 *
 * pi's tool blocks are rendered by the tools themselves. This package takes
 * those renderers over — see tools/override.ts for the one mechanism every
 * feature goes through — and applies features to what they produced:
 *
 *   mark/   a glyph per block: which tool ran, and how it went
 *   bash/   the command line, layered the way pi's other six titles are
 *
 * Config:   ~/.pi/agent/tool-blocks.json
 * Command:  /tool-marks  glyphs | letters | off
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { prepare } from "./bash/engine.ts";
import { retitling } from "./bash/title.ts";
import { FRAMES, type FrameStyle, loadConfig, type MarkStyle, saveConfig } from "./mark/config.ts";
import { ICON, LETTER } from "./mark/icons.ts";
import { framing } from "./box/index.ts";
import { marking } from "./mark/index.ts";
import { TOOLS } from "./tools/builtins.ts";
import { present } from "./tools/override.ts";

export default async function (pi: ExtensionAPI) {
	let { style, frame } = loadConfig();
	const cwd = process.cwd();

	// Awaited, not fired and forgotten. pi awaits the extension factory, and
	// renderCall is synchronous: a highlighter that arrives after the transcript
	// has been drawn never gets used, because nothing draws it again. That is
	// what /reload looked like — the module state resets, registration wins the
	// race, and every block renders unhighlighted and stays that way.
	await prepare();

	for (const tool of TOOLS) {
		pi.registerTool(
			present(tool, cwd, {
				// The framing goes outside the mark, so the mark sits inside it.
				// It is drawn in halves: the title opens it, the result closes
				// it, because pi renders those as two sibling components and
				// nothing sees both.
				frame: (inner, args, theme, context) =>
					framing(frame, theme, context, "head")(marking(tool, () => style)(inner, args, theme, context)),
				frameResult: (inner, theme, context) => framing(frame, theme, context, "tail")(inner),
				...(tool === "bash" ? { retitle: retitling() } : {}),
			}) as never,
		);
	}

	pi.registerCommand("tool-marks", {
		description: "Mark tool blocks with glyphs, letters, or nothing",
		async handler(args, ctx) {
			const wanted = args.trim().toLowerCase();
			const choices: MarkStyle[] = ["glyphs", "letters", "off"];
			const next = choices.includes(wanted as MarkStyle)
				? (wanted as MarkStyle)
				: await ctx.ui.select("Mark tool blocks with", [
						{ label: `glyphs   ${ICON.read} ${ICON.bash} ${ICON.edit}  (needs a Nerd Font)`, value: "glyphs" },
						{ label: `letters  ${LETTER.read} ${LETTER.bash} ${LETTER.edit}  (any font)`, value: "letters" },
						{ label: "off", value: "off" },
					] as never);
			if (!next) return;
			style = next as MarkStyle;
			saveConfig({ style, frame });
			ctx.ui.notify(`Tool marks: ${style}`);
		},
	});

	pi.registerCommand("tool-frame", {
		description: "Set apart tool blocks with a rail, a bracket, or a box",
		async handler(args, ctx) {
			const wanted = args.trim().toLowerCase();
			const next = FRAMES.includes(wanted as FrameStyle)
				? (wanted as FrameStyle)
				: await ctx.ui.select("Set tool blocks apart with", [
						{ label: "rail     │  one column, like pi's own block quotes", value: "rail" },
						{ label: "bracket  ╭ ╰  a corner and a foot, like its code blocks", value: "bracket" },
						{ label: "box      ╭─╮  encloses; the only one that states where a block ends", value: "box" },
					] as never);
			if (!next) return;
			frame = next as FrameStyle;
			saveConfig({ style, frame });
			ctx.ui.notify(`Tool frame: ${frame}`);
		},
	});
}
