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
import { loadConfig, saveConfig, type MarkStyle } from "./mark/config.ts";
import { ICON, LETTER } from "./mark/icons.ts";
import { marking } from "./mark/index.ts";
import { TOOLS } from "./tools/builtins.ts";
import { present } from "./tools/override.ts";

export default function (pi: ExtensionAPI) {
	let style = loadConfig().style;
	const cwd = process.cwd();

	// Preparing the highlighter is async and renderCall is not, so it is started
	// here and used synchronously once ready. Commands rendered before it is are
	// left as pi renders them; nothing waits.
	void prepare();

	for (const tool of TOOLS) {
		pi.registerTool(
			present(tool, cwd, {
				frame: marking(tool, () => style),
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
			saveConfig({ style });
			ctx.ui.notify(`Tool marks: ${style}`);
		},
	});
}
