/**
 * Contracts with pi that the type system cannot express.
 *
 * Run: pnpm test
 *
 * wrap.test.ts covers the framing against a stub. This covers the assumptions
 * about pi that make the framing safe to apply to its own tools, and that would
 * otherwise fail silently: tool-execution catches renderer errors and falls
 * back to a plain title, so a broken wrapper looks like a styling regression
 * rather than a crash.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createReadToolDefinition, initTheme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

import { ICON, LETTER, TOOLS } from "./icons.ts";
import { marked } from "./index.ts";
import { GUTTER, withMark } from "./wrap.ts";

/** A theme that reports which colour each piece of text was given. */
const probe = {
	fg: (token: string, text: string) => `<${token}>${text}</${token}>`,
	bold: (text: string) => text,
} as never;

function context(overrides: Record<string, unknown> = {}) {
	return {
		args: {},
		toolCallId: "t1",
		invalidate: () => {},
		lastComponent: undefined,
		state: {},
		cwd: process.cwd(),
		executionStarted: false,
		argsComplete: true,
		isPartial: false,
		expanded: false,
		showImages: true,
		isError: false,
		...overrides,
	} as never;
}

describe("pi's built-in tools", () => {
	it("still expose a call renderer to wrap", () => {
		for (const tool of TOOLS) {
			const definition = marked(tool, process.cwd(), () => "glyphs");
			assert.equal(typeof definition.renderCall, "function", `${tool} has no renderCall`);
		}
	});

	it("still carry the fields that must pass through untouched", () => {
		// Registering a tool replaces the built-in entirely, so anything dropped
		// here stops working rather than falling back.
		// The factory closes over cwd afresh each call, so identity only means
		// anything against the very object that was wrapped.
		const built = createReadToolDefinition(process.cwd());
		const wrapped = marked("read", process.cwd(), () => "glyphs", built);
		const changed = Object.keys(built).filter(
			(field) => wrapped[field as keyof typeof wrapped] !== built[field as keyof typeof built],
		);
		assert.deepEqual(changed, ["renderCall"], "the wrapper changed more than the call renderer");
	});

	it("returns a component, not a string", () => {
		const rendered = createReadToolDefinition(process.cwd()).renderCall?.(
			{ file_path: "/tmp/x.ts" } as never,
			probe,
			context(),
		);
		assert.equal(typeof rendered?.render, "function");
	});

	it("updates the component it was handed rather than making a new one", () => {
		// This is why the inner component is kept in state: hand the built-in the
		// wrapper instead and its setText call throws.
		const definition = createReadToolDefinition(process.cwd());
		const first = definition.renderCall!({ file_path: "/tmp/a.ts" } as never, probe, context());
		const second = definition.renderCall!(
			{ file_path: "/tmp/b.ts" } as never,
			probe,
			context({ lastComponent: first }),
		);
		assert.equal(second, first, "pi's renderer no longer reuses lastComponent");
	});

	it("throws when handed something that is not its own component", () => {
		const definition = createReadToolDefinition(process.cwd());
		const alien: Component = { render: () => ["x"], invalidate: () => {} };
		assert.throws(
			() => definition.renderCall!({ file_path: "/tmp/a.ts" } as never, probe, context({ lastComponent: alien })),
			"handing pi's renderer a foreign component no longer throws, so the state handoff may be unnecessary",
		);
	});
});

describe("marked", () => {
	it("hands the built-in its own component, never the wrapper", () => {
		const definition = marked("read", process.cwd(), () => "glyphs");
		const state = {};
		const first = definition.renderCall!({ file_path: "/tmp/a.ts" } as never, probe, context({ state }));
		// A second render must not throw, which it would if the wrapper leaked.
		const second = definition.renderCall!({ file_path: "/tmp/b.ts" } as never, probe, context({ state, lastComponent: first }));
		assert.notEqual(second, first, "the wrapper should be fresh each render");
		assert.ok(second.render(60).length > 0);
	});

	it("keeps its component out of the key edit uses for its diff preview", () => {
		const state: Record<string, unknown> = {};
		marked("read", process.cwd(), () => "glyphs").renderCall!({ file_path: "/tmp/a.ts" } as never, probe, context({ state }));
		assert.deepEqual(Object.keys(state), ["__toolIconsInner"], "unexpected keys in pi's per-row state");
	});

	it("colours the mark by how the call turned out", () => {
		const cases = [
			[{ isPartial: true, isError: false }, "muted"],
			[{ isPartial: false, isError: false }, "success"],
			[{ isPartial: false, isError: true }, "error"],
		] as const;
		for (const [state, token] of cases) {
			const out = marked("read", process.cwd(), () => "glyphs")
				.renderCall!({ file_path: "/tmp/a.ts" } as never, probe, context(state))
				.render(60);
			assert.ok(out[0]!.startsWith(`<${token}>`), `expected ${token}, got ${out[0]!.slice(0, 20)}`);
		}
	});

	it("uses the glyph, the letter, or nothing, as configured", () => {
		const render = (style: "glyphs" | "letters" | "off") =>
			marked("read", process.cwd(), () => style)
				.renderCall!({ file_path: "/tmp/a.ts" } as never, probe, context())
				.render(60)[0]!;
		assert.ok(render("glyphs").includes(ICON.read));
		assert.ok(render("letters").includes(LETTER.read));
		assert.ok(!render("off").includes(ICON.read));
		assert.ok(!render("off").startsWith(" "), "off should not leave the gutter behind");
	});
});

describe("the real theme", () => {
	it("has the colour tokens the marks ask for", () => {
		// theme.fg throws on an unknown token, and tool-execution would swallow it.
		initTheme("dark");
		const rendered = marked("read", process.cwd(), () => "glyphs").renderCall!(
			{ file_path: "/tmp/a.ts" } as never,
			// The real theme is a module singleton; this exercises it through pi.
			(globalThis as never as { theme?: never }).theme ?? probe,
			context(),
		);
		assert.ok(rendered.render(60)[0]!.length > GUTTER);
	});
});

describe("withMark against pi's own component", () => {
	it("does not disturb what the built-in produced", () => {
		const inner = createReadToolDefinition(process.cwd()).renderCall!(
			{ file_path: "/tmp/a.ts" } as never,
			probe,
			context(),
		);
		const bare = inner.render(60 - GUTTER);
		const framed = withMark(inner, "*").render(60);
		assert.deepEqual(
			framed.map((line) => line.slice(GUTTER)),
			bare,
		);
	});
});
