/**
 * The rules that decide whether a block gets a sentence, and how often.
 *
 * Run: pnpm test
 *
 * Every one of these was a bug first: the sentence was asked for again on every
 * redraw, asked for again after a failure, and asked for one-line commands that
 * already say what they do.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	pick,
	INSTRUCTION,
	MAX_COMMAND_CHARS,
	type Slot,
	summaryFor,
	WRITER,
	tidy,
	useRegistry,
	worthSummarising,
} from "./summary.ts";

/** A registry that answers instantly and counts what it was asked. */
function stubRegistry(answer = "generates test data") {
	const asked: string[] = [];
	const registry = {
		getAvailable: () => [{ id: WRITER, provider: "github-copilot" }],
		complete: async (_model: unknown, context: { messages: { content: string }[] }) => {
			asked.push(context.messages[0].content);
			return { role: "assistant", content: [{ type: "text", text: answer }] };
		},
	};
	return { registry, asked };
}

/** Wait for the promise chain inside summaryFor to settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("when a sentence is asked for", () => {
	it("leaves a one-line command alone", () => {
		// `ls -la | tail` is its own summary.
		assert.equal(worthSummarising("ls -la | tail -4"), false);
		assert.equal(worthSummarising("cat > f <<'EOF'\nbody\nEOF"), true);
	});

	it("asks once, however many times the block is drawn", async () => {
		const { registry, asked } = stubRegistry();
		useRegistry(registry as never);
		const slot: Slot = {};
		const command = "cat > f <<'EOF'\nbody\nEOF";
		for (let draw = 0; draw < 5; draw += 1) summaryFor(command, slot, () => {});
		await settle();
		for (let draw = 0; draw < 5; draw += 1) summaryFor(command, slot, () => {});
		assert.equal(asked.length, 1);
	});

	it("asks again when the command itself changes", async () => {
		const { registry, asked } = stubRegistry();
		useRegistry(registry as never);
		const slot: Slot = {};
		summaryFor("cat > a <<'EOF'\nx\nEOF", slot, () => {});
		await settle();
		summaryFor("cat > b <<'EOF'\ny\nEOF", slot, () => {});
		await settle();
		assert.equal(asked.length, 2);
	});

	it("sends the command, capped, under the instruction", async () => {
		const { registry, asked } = stubRegistry();
		useRegistry(registry as never);
		const command = `head\n${"x".repeat(MAX_COMMAND_CHARS * 2)}`;
		summaryFor(command, {}, () => {});
		await settle();
		assert.ok(asked[0].startsWith(INSTRUCTION));
		assert.ok(asked[0].length < MAX_COMMAND_CHARS + INSTRUCTION.length + 8);
	});
});

describe("what comes back", () => {
	it("redraws the block once the sentence has arrived", async () => {
		const { registry } = stubRegistry();
		useRegistry(registry as never);
		let redraws = 0;
		const slot: Slot = {};
		const command = "cat > f <<'EOF'\nbody\nEOF";
		assert.equal(summaryFor(command, slot, () => { redraws += 1; }), undefined);
		await settle();
		assert.equal(redraws, 1);
		assert.equal(summaryFor(command, slot, () => {}), "generates test data");
	});

	it("gives up quietly when the model fails", async () => {
		const registry = {
			getAvailable: () => [{ id: WRITER, provider: "github-copilot" }],
			complete: async () => { throw new Error("no"); },
		};
		useRegistry(registry as never);
		const slot: Slot = {};
		const command = "cat > f <<'EOF'\nbody\nEOF";
		summaryFor(command, slot, () => {});
		await settle();
		// Undefined means the line is simply absent, not an error in the block.
		assert.equal(summaryFor(command, slot, () => {}), undefined);
		assert.equal(slot.summary?.text, null);
	});

	it("does not ask again after a failure", async () => {
		let calls = 0;
		useRegistry({
			getAvailable: () => [{ id: WRITER, provider: "github-copilot" }],
			complete: async () => { calls += 1; throw new Error("no"); },
		} as never);
		const slot: Slot = {};
		const command = "cat > f <<'EOF'\nbody\nEOF";
		summaryFor(command, slot, () => {});
		await settle();
		for (let draw = 0; draw < 3; draw += 1) summaryFor(command, slot, () => {});
		await settle();
		assert.equal(calls, 1);
	});

	it("says nothing when there is no model to ask", () => {
		useRegistry(undefined);
		assert.equal(summaryFor("cat > f <<'EOF'\nx\nEOF", {}, () => {}), undefined);
	});
});

describe("tidy", () => {
	it("removes the quotes and full stop a model adds anyway", () => {
		// The instruction asks for none of these. Models add them regardless.
		assert.equal(tidy('"writes report.md."'), "writes report.md");
		assert.equal(tidy("`counts rows`"), "counts rows");
		assert.equal(tidy("  builds the site.  "), "builds the site");
	});
});

describe("choosing who writes them", () => {
	const model = (id: string, output: number) => ({ id, provider: "p", cost: { output } });

	it("prefers the ones that were measured", () => {
		// Twelve real commands, four instructions, eight models, ranked blind by
		// a stronger model: sonnet-4.6 6.4, haiku-4.5 5.2, everything else 4.8
		// to 5.8 and three to seven times slower.
		const available = [model("gemini-3.7-flash", 1), model("claude-haiku-4.5", 5), model(WRITER, 15)];
		assert.equal(pick(available as never)?.id, WRITER);
	});

	it("does not drift to another model when the pinned one is present", () => {
		// Each model writes in a recognisably different way. A note whose voice
		// changes because an account gained a cheaper model is worse than one
		// written by something slightly weaker.
		const available = [model("something-cheaper", 1), model(WRITER, 15)];
		assert.equal(pick(available as never)?.id, WRITER);
	});

	it("takes the cheapest when none of them is configured", () => {
		// An account with neither should still get sentences rather than silence.
		const available = [model("expensive", 40), model("cheap", 2), model("middling", 9)];
		assert.equal(pick(available as never)?.id, "cheap");
	});

	it("says nothing when there is nothing at all", () => {
		assert.equal(pick([]), undefined);
	});
});
