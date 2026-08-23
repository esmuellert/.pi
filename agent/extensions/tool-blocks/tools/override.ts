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
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

import { blank, keepBackground, openingBackground, plain } from "../shared/ansi.ts";
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
 * Where a self-framing tool's result is left for its call renderer to read.
 * Shared through the state pi keeps per row across both renders.
 */
const OUTPUT = "__toolBlocksOutput";

/**
 * Rewrite the title a built-in produced, and frame what comes back.
 *
 * `retitle` returns what should be shown instead, or undefined to leave pi's
 * rendering alone. `frame` wraps the finished component, for a mark in the
 * gutter.
 *
 * What pi rendered is behind a function rather than passed in. Producing it
 * costs pi a full render, and a retitle that replaces the title outright never
 * looks at it — 123ms per frame across a session's blocks, spent building
 * something thrown away. Asking for it only when it is wanted costs nothing
 * when it is not.
 */
export type Presentation = {
	readonly retitle?: (
		rendered: () => string[],
		width: number,
		args: RenderArgs,
		theme: Theme,
		context: RenderContext,
	) => string[] | undefined;
	readonly frame?: (inner: Component, args: RenderArgs, theme: Theme, context: RenderContext) => Component;
	/**
	 * Lines to add under everything else, after the result has arrived.
	 *
	 * A separate hook from `retitle` because the title is the command, and a
	 * note about the command should not stand where the command was.
	 *
	 * Given the width it will be drawn in, because a note long enough to need
	 * one is exactly the note worth having.
	 */
	readonly footnote?: (
		width: number,
		args: RenderArgs,
		output: string,
		theme: Theme,
		context: RenderContext,
	) => string[] | undefined;
};

/**
 * A component that renders `lines` instead of whatever `inner` would.
 *
 * The inner render is memoised per width so that a retitle which asks for it
 * and then declines does not pay for it twice.
 */
function replacing(inner: Component, lines: (width: number, rendered: () => string[]) => string[] | undefined): Component {
	let memo: { width: number; lines: string[] } | undefined;
	const rendered = (width: number) => () => {
		if (memo?.width !== width) memo = { width, lines: inner.render(width) };
		return memo.lines;
	};
	return {
		render: (width) => lines(width, rendered(width)) ?? rendered(width)(),
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
	const renderResult = definition.renderResult;
	// `edit` draws its whole block from renderCall, reading what renderResult
	// left in `context.state`; its own renderResult contributes no lines. A
	// footnote appended there would be appended to nothing, and land outside
	// the frame at column zero. For those tools the note goes on the call
	// instead, and the result is recorded for it to read -- the same handover
	// the tool already uses.
	const selfFramed = definition.renderShell === "self";

	return {
		...definition,
		...(presentation.footnote && renderResult
			? {
				renderResult(result: unknown, options: unknown, theme: Theme, context: RenderContext): Component {
					// pi hands back what this returned as `lastComponent` and reuses it:
					// bash's renderer calls clear() and addChild() on it. Given a
					// wrapper it called them on something that has neither, which
					// threw, and pi's fallback drew the output without its own
					// "Took 0.0s" -- every other render, since the failure cleared
					// the reference and the one after started fresh.
					const inner = renderResult(
						result as never,
						options as never,
						theme,
						{ ...context, lastComponent: unwrap(context.lastComponent) } as never,
					);
					// The footnote is asked for on every render rather than once
					// here, because what it has to say arrives later than this
					// call and pi may reuse the component it was given.
					if (selfFramed) {
						(context.state as Record<string, unknown>)[OUTPUT] = printed(result);
						return inner;
					}
					return appending(inner, (width) =>
						presentation.footnote?.(width, context.args as RenderArgs, printed(result), theme, context),
					);
				},
			}
			: {}),
		renderCall(args: RenderArgs, theme: Theme, context: RenderContext): Component {
			const state = context.state as Record<string, unknown>;
			const inner = renderCall(args, theme, { ...context, lastComponent: state[INNER] as Component | undefined });
			state[INNER] = inner;

			const retitled = presentation.retitle
				? replacing(inner, (width, rendered) => presentation.retitle?.(rendered, width, args, theme, context))
				: inner;
			const noted =
				selfFramed && presentation.footnote
					? framing(retitled, (width) =>
							state[OUTPUT] === undefined
								? undefined
								: presentation.footnote?.(width, args, state[OUTPUT] as string, theme, context),
						)
					: retitled;
			return presentation.frame ? presentation.frame(noted, args, theme, context) : noted;
		},
	};
}

/**
 * A component that draws `inner`, then whatever `extra` has to say.
 *
 * `extra` is a function so that a footnote which is not ready yet costs one
 * call returning undefined, and the lines below simply are not there. It is
 * given the width, because anything it adds has to fit the same column.
 *
 * A footnote that throws must not take the block with it. pi catches a renderer
 * that throws while it is being built, but this runs during `render`, which is
 * below that guard: an exception here reaches Box and the whole block vanishes,
 * pi's own "Took 0.0s" along with it.
 */
function appending(inner: Component, extra: (width: number) => string[] | undefined): Component {
	return {
		[WRAPPED]: inner,
		render(width: number): string[] {
			const lines = inner.render(width);
			let tail: string[] | undefined;
			try {
				tail = extra(width);
			} catch {
				return lines;
			}
			return tail && tail.length > 0 ? [...lines, ...tail] : lines;
		},
		invalidate() {
			inner.invalidate?.();
		},
	} as Component;
}

/** What a wrapper is wrapping, so pi gets its own component back. */
const WRAPPED = Symbol("toolBlocksWrapped");

/** The component inside a wrapper, or whatever was passed if it is not one. */
function unwrap(component: Component | undefined): Component | undefined {
	return (component as { [WRAPPED]?: Component } | undefined)?.[WRAPPED] ?? component;
}

/** A component that draws `inner`, then whatever `extra` says, inside the frame. */
function framing(inner: Component, extra: (width: number) => string[] | undefined): Component {
	return {
		[WRAPPED]: inner,
		render(width: number): string[] {
			const lines = inner.render(width);
			let tail: string[] | undefined;
			try {
				tail = extra(width);
			} catch {
				return lines;
			}
			return tail && tail.length > 0 ? within(lines, tail, width) : lines;
		},
		invalidate() {
			inner.invalidate?.();
		},
	} as Component;
}

/**
 * Put `tail` inside the frame `lines` drew for themselves.
 *
 * Six of pi's seven tools render into a Box it provides, so lines handed back
 * land inside it and wear its background and padding. `edit` declares
 * `renderShell: "self"` and draws its own frame, so the same lines land outside
 * one, in the terminal's background at column zero.
 *
 * Everything needed to match is in what the tool already drew: the background
 * off a line that has one, the padding from the narrowest indent any line uses,
 * and the place from the last line with something on it. Nothing here names a
 * colour or a width, so a tool that frames itself differently is still matched.
 */
function within(lines: string[], tail: string[], width: number): string[] {
	const content = lines.filter((line) => !blank(line));
	const last = lines.findLastIndex((line) => !blank(line));
	if (content.length === 0 || last < 0) return [...lines, ...tail];
	const background = content.map(openingBackground).find(Boolean);
	const indent = Math.min(...content.map((line) => plain(line).length - plain(line).trimStart().length));
	const room = Math.max(0, width - indent);
	const framed = tail.map((line) => {
		const body = " ".repeat(indent) + truncateToWidth(line, room);
		const padded = body + " ".repeat(Math.max(0, width - visibleWidth(body)));
		return background ? background + keepBackground(padded) + "\u001b[49m" : padded;
	});
	return [...lines.slice(0, last + 1), ...framed, ...lines.slice(last + 1)];
}

/** The text a tool result carries, for a footnote that wants to read it. */
function printed(result: unknown): string {
	const parts = (result as { content?: { type?: string; text?: string }[] } | undefined)?.content;
	return Array.isArray(parts)
		? parts.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n")
		: "";
}
