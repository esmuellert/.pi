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
import { noting, useRegistry } from "./summary/noting.ts";
import { TOOLS } from "./tools/builtins.ts";
import { present } from "./tools/override.ts";

export default async function (pi: ExtensionAPI) {
	let style = loadConfig().style;
	const cwd = process.cwd();

	// Awaited, not fired and forgotten. pi awaits the extension factory, and
	// renderCall is synchronous: a highlighter that arrives after the transcript
	// has been drawn never gets used, because nothing draws it again. That is
	// what /reload looked like — the module state resets, registration wins the
	// race, and every block renders unhighlighted and stays that way.
	await prepare();

	// The sentence under a bash block is written by a second, cheaper model, and
	// reaching one needs a registry that only exists once a session does.
	pi.on("session_start", async (_event, ctx) => useRegistry(ctx.modelRegistry, ctx.sessionManager));

	for (const tool of TOOLS) {
		pi.registerTool(
			present(tool, cwd, {
				frame: marking(tool, () => style),
				footnote: noting(tool),
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
