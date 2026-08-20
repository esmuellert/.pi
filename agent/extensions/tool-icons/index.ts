/**
 * Mark each tool block with a glyph for what ran and how it went.
 *
 * pi's tool headers already say which tool and on what, but a header set in the
 * body's own colour reads as body. This puts a single glyph in front of it:
 * where it sits marks the start of the header, its shape says which tool, and
 * its colour says whether the call is still running, worked, or failed — the
 * one thing the header never says. Nothing else changes. The title text, the
 * block background and the tools themselves are pi's.
 *
 * pi picks a renderer per field, preferring a registered tool's over the
 * built-in's, so each tool is re-registered as the built-in definition with
 * only renderCall replaced. execute, parameters, description and renderShell
 * are the ones pi ships.
 *
 * Config:  ~/.pi/agent/tool-icons.json  (see ./config.ts)
 * Command: /tool-icons  glyphs | letters | off
 */

import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ExtensionAPI,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

/**
 * pi exports the tool factories but not ToolDefinition or ToolRenderContext, so
 * the shapes are read back off a factory. Deriving them from the function being
 * wrapped is also the stricter choice: they cannot drift from it.
 */
type BuiltIn = ReturnType<typeof createReadToolDefinition>;
type RenderCall = NonNullable<BuiltIn["renderCall"]>;
type RenderArgs = Parameters<RenderCall>[0];
type RenderContext = Parameters<RenderCall>[2];

import { loadConfig, saveConfig, type MarkStyle } from "./config.ts";
import { ICON, LETTER, OUTCOME_COLOR, outcomeOf, TOOLS, type ToolName } from "./icons.ts";
import { withMark } from "./wrap.ts";

/** The built-in definition for each tool this extension re-registers. */
const FACTORY: Readonly<Record<ToolName, (cwd: string) => BuiltIn>> = {
	read: createReadToolDefinition,
	bash: createBashToolDefinition,
	edit: createEditToolDefinition,
	write: createWriteToolDefinition,
	ls: createLsToolDefinition,
	grep: createGrepToolDefinition,
	find: createFindToolDefinition,
} as unknown as Readonly<Record<ToolName, (cwd: string) => BuiltIn>>;

/**
 * Where the built-in renderer's own component is kept.
 *
 * pi hands a renderer the component it returned last time so it can update it
 * in place. Returning the wrapper would hand the built-in something that is not
 * the Text it expects, and its setText call would throw — silently, since
 * tool-execution catches renderer errors and falls back. So the inner component
 * is kept alongside pi's per-row renderer state, under a key the tools do not
 * use. edit keeps its diff preview in that same object.
 */
const INNER = "__toolIconsInner";

type Stateful = Record<string, unknown>;

export function markFor(tool: ToolName, style: MarkStyle, theme: Theme, context: { isPartial: boolean; isError: boolean }): string {
	const glyph = style === "letters" ? LETTER[tool] : ICON[tool];
	return theme.fg(OUTCOME_COLOR[outcomeOf(context)] as never, glyph);
}

/**
 * The built-in definition with its call renderer framed by a mark.
 *
 * `builtIn` is injectable so a test can hold the same object and check that
 * everything except renderCall came through by identity. Registering a tool
 * replaces the built-in outright, so a field dropped here stops working.
 */
export function marked(tool: ToolName, cwd: string, style: () => MarkStyle, builtIn = FACTORY[tool](cwd)): BuiltIn {
	const renderCall = builtIn.renderCall;
	if (!renderCall) return builtIn;

	return {
		...builtIn,
		renderCall(args: RenderArgs, theme: Theme, context: RenderContext): Component {
			const state = context.state as Stateful;
			const inner = renderCall(args, theme, { ...context, lastComponent: state[INNER] as Component | undefined });
			state[INNER] = inner;
			if (style() === "off") return inner;
			return withMark(inner, markFor(tool, style(), theme, context));
		},
	};
}

export default function (pi: ExtensionAPI) {
	let style = loadConfig().style;
	const cwd = process.cwd();

	for (const tool of TOOLS) {
		pi.registerTool(marked(tool, cwd, () => style) as never);
	}

	pi.registerCommand("tool-icons", {
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
