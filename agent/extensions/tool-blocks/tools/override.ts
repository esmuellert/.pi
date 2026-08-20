/**
 * Taking a tool over from pi without taking on its job.
 *
 * pi resolves renderers field by field, preferring a registered tool's over the
 * built-in's, so a tool re-registered as the built-in with one field replaced
 * keeps pi's execute, parameters, description and renderShell. Registering a
 * tool replaces the built-in outright, which is why nothing else may be
 * touched: a dropped field stops working rather than falling back.
 *
 * Only one extension can win this. pi merges definitions with Map.set, so if
 * two extensions register `bash`, the one loaded last silently replaces the
 * other. Every feature in this package therefore goes through here, and this
 * file composes them, rather than each feature registering the tool itself.
 */

import type { Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

import { builtIn, type BuiltIn, type RenderArgs, type RenderContext, type ToolName } from "./builtins.ts";

/**
 * Where a built-in renderer's own component is kept.
 *
 * pi hands a renderer the component it returned last time so it can update it
 * in place. Handing the built-in a wrapper instead gives it something that is
 * not the Text it expects, and its setText call throws — silently, since
 * tool-execution catches renderer errors and falls back. So the inner component
 * lives alongside pi's per-row renderer state, under a key the tools do not
 * use. edit keeps its diff preview in that same object.
 */
const INNER = "__toolBlocksInner";

/**
 * Rewrite the title a built-in produced, and frame what comes back.
 *
 * `retitle` sees the lines pi rendered and returns what should be shown
 * instead; returning undefined leaves them alone. `frame` wraps the finished
 * component, for a mark in the gutter.
 */
export type Presentation = {
	readonly retitle?: (lines: string[], args: RenderArgs, theme: Theme, context: RenderContext) => string[] | undefined;
	readonly frame?: (inner: Component, args: RenderArgs, theme: Theme, context: RenderContext) => Component;
};

/** A component that renders `lines` instead of whatever `inner` would. */
function replacing(inner: Component, lines: (width: number) => string[] | undefined): Component {
	return {
		render: (width) => lines(width) ?? inner.render(width),
		invalidate: () => inner.invalidate(),
		...(typeof inner.handleInput === "function"
			? { handleInput: (data: string) => inner.handleInput?.(data) }
			: {}),
		...(inner.wantsKeyRelease === undefined ? {} : { wantsKeyRelease: inner.wantsKeyRelease }),
	};
}

/** pi's definition for `tool`, with `presentation` applied to its call renderer. */
export function present(
	tool: ToolName,
	cwd: string,
	presentation: Presentation,
	definition: BuiltIn = builtIn(tool, cwd),
): BuiltIn {
	const renderCall = definition.renderCall;
	if (!renderCall) return definition;

	return {
		...definition,
		renderCall(args: RenderArgs, theme: Theme, context: RenderContext): Component {
			const state = context.state as Record<string, unknown>;
			const inner = renderCall(args, theme, { ...context, lastComponent: state[INNER] as Component | undefined });
			state[INNER] = inner;

			const retitled = presentation.retitle
				? replacing(inner, (width) => presentation.retitle?.(inner.render(width), args, theme, context))
				: inner;
			return presentation.frame ? presentation.frame(retitled, args, theme, context) : retitled;
		},
	};
}
