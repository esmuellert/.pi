/**
 * Contracts with pi that the type system cannot express.
 *
 * Run: pnpm test
 *
 * tool-execution catches renderer errors and falls back to a plain title, so a
 * broken override looks like a styling regression rather than a crash. These
 * hold pi to the behaviour that makes the override safe.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createReadToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

import { builtIn, TOOLS } from "./builtins.ts";
import { present } from "./override.ts";

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
			const definition = present(tool, process.cwd(), {});
			assert.equal(typeof definition.renderCall, "function", `${tool} has no renderCall`);
		}
	});

	it("still carry the fields that must pass through untouched", () => {
		// Registering a tool replaces the built-in entirely, so anything dropped
		// here stops working rather than falling back.
		// The factory closes over cwd afresh each call, so identity only means
		// anything against the very object that was wrapped.
		const built = createReadToolDefinition(process.cwd());
		const wrapped = present("read", process.cwd(), {}, built);
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

describe("present", () => {
	it("hands the built-in its own component, never the wrapper", () => {
		const frame = (inner: Component) => ({ ...inner, render: (w: number) => inner.render(w) }) as Component;
		const definition = present("read", process.cwd(), { frame });
		const state = {};
		const first = definition.renderCall!({ file_path: "/tmp/a.ts" } as never, probe, context({ state }));
		// A second render must not throw, which it would if the wrapper leaked.
		const second = definition.renderCall!({ file_path: "/tmp/b.ts" } as never, probe, context({ state, lastComponent: first }));
		assert.ok(second.render(60).length > 0);
	});

	it("keeps its component out of the key edit uses for its diff preview", () => {
		const state: Record<string, unknown> = {};
		present("read", process.cwd(), {}).renderCall!({ file_path: "/tmp/a.ts" } as never, probe, context({ state }));
		assert.deepEqual(Object.keys(state), ["__toolBlocksInner"], "unexpected keys in pi's per-row state");
	});

	it("changes nothing but the call renderer", () => {
		// Registering a tool replaces the built-in outright, so a dropped field
		// stops working rather than falling back.
		const built = createReadToolDefinition(process.cwd());
		const wrapped = present("read", process.cwd(), {}, built);
		const changed = Object.keys(built).filter(
			(field) => wrapped[field as keyof typeof wrapped] !== built[field as keyof typeof built],
		);
		assert.deepEqual(changed, ["renderCall"]);
	});

	it("leaves a tool without a call renderer alone", () => {
		const bare = { ...createReadToolDefinition(process.cwd()), renderCall: undefined };
		assert.equal(present("read", process.cwd(), {}, bare as never), bare);
	});

	it("lets retitle replace the lines pi produced", () => {
		const definition = present("read", process.cwd(), { retitle: () => ["replaced"] });
		assert.deepEqual(definition.renderCall!({ file_path: "/tmp/a.ts" } as never, probe, context()).render(60), ["replaced"]);
	});

	it("keeps pi's lines when retitle declines", () => {
		const plain = builtIn("read", process.cwd()).renderCall!({ file_path: "/tmp/a.ts" } as never, probe, context()).render(60);
		const definition = present("read", process.cwd(), { retitle: () => undefined });
		assert.deepEqual(definition.renderCall!({ file_path: "/tmp/a.ts" } as never, probe, context()).render(60), plain);
	});
});

describe("footnote", () => {
	/**
	 * A stand-in for whatever pi renders, so these stay off the real renderer.
	 * Calling that needs an initialised theme, which no test here has, and what
	 * is under test is the wrapper rather than pi's drawing.
	 */
	const stub = { render: () => ["block"], invalidate: () => {} };
	const wrap = (footnote: (width: number) => string[] | undefined) =>
		present("bash", "/tmp", { footnote }, { renderCall: () => stub, renderResult: () => stub } as never);

	it("asks on every render, not once when the component is built", () => {
		// What it has to say arrives after renderResult has returned, and pi
		// reuses the component it was given. Asking once means a sentence that
		// arrives late is never shown.
		let asked = 0;
		const definition = wrap(() => (++asked > 1 ? ["  late"] : undefined));
		const component = definition.renderResult?.({} as never, {} as never, probe, context() as never);
		assert.deepEqual(component?.render(40), ["block"]);
		assert.deepEqual(component?.render(40), ["block", "  late"]);
	});

	it("leaves the block alone when there is nothing to add", () => {
		const definition = wrap(() => undefined);
		const component = definition.renderResult?.({} as never, {} as never, probe, context() as never);
		assert.deepEqual(component?.render(40), ["block"]);
	});

	it("is not wrapped at all when no footnote is given", () => {
		// The wrapper costs a call per render, so a tool without a footnote keeps
		// pi's own renderer rather than a pass-through around it.
		const original = () => stub;
		const plain = present("bash", "/tmp", {}, { renderCall: () => stub, renderResult: original } as never);
		assert.equal(plain.renderResult, original);
	});
});
