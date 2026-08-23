import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ask, type ContextMessage, INSTRUCTION, MAX_CHARS, nameFor, pick, textOf, tidy, transcript, WRITER } from "./name.ts";

const said = (role: string, text: string): ContextMessage => ({ role, content: [{ type: "text", text }] });

describe("what the writer is shown", () => {
	it("carries the whole conversation, not a sample", () => {
		// Which part of a session gives it its name is not something a rule can
		// decide in advance, and after compaction the live context is a fifth
		// the size of the session file -- small enough to send whole.
		const messages = Array.from({ length: 400 }, (_, at) => said(at % 2 ? "assistant" : "user", `turn ${at}`));
		const body = transcript(messages);
		assert.ok(body.includes("turn 0"), "dropped the beginning");
		assert.ok(body.includes("turn 399"), "dropped the end");
	});

	it("says who spoke", () => {
		const body = transcript([said("user", "make it green"), said("assistant", "done")]);
		assert.match(body, /USER: make it green/);
		assert.match(body, /ASSISTANT: done/);
	});

	it("leaves out what tools printed", () => {
		// Tool results are what a session did rather than what it was about, and
		// they are most of its bytes -- 90% of the one this was written in.
		const body = transcript([
			said("user", "check the tests"),
			{ role: "toolResult", content: [{ type: "text", text: "SECRET-OUTPUT" }] },
		]);
		assert.ok(!body.includes("SECRET-OUTPUT"));
	});

	it("names a tool call without repeating its arguments", () => {
		const call = { role: "assistant", content: [{ type: "toolCall", name: "bash", arguments: { command: "rm -rf /" } }] };
		assert.equal(textOf(call), "[bash]");
	});

	it("reads a plain string as well as parts", () => {
		assert.equal(textOf({ role: "user", content: "hello" }), "hello");
		assert.equal(textOf({ role: "user" }), "");
	});

	it("opens with the instruction", () => {
		const body = ask("USER: hi");
		assert.ok(body.startsWith(INSTRUCTION));
		assert.match(body, /THE CONVERSATION:\nUSER: hi/);
	});

	it("asks for the user's language rather than deciding one", () => {
		// A CJK-ratio test calls Spanish, French, German and Russian all
		// English. The writer has the conversation in front of it.
		assert.match(INSTRUCTION, /language its user writes in/);
	});
});

describe("the name that comes back", () => {
	it("strips quotes a model added around it", () => {
		for (const quoted of ['"Tool block summaries"', "'Tool block summaries'", "`Tool block summaries`", "「Tool block summaries」"]) {
			assert.equal(tidy(quoted), "Tool block summaries");
		}
	});

	it("is one line", () => {
		assert.equal(tidy("Tool block\nsummaries"), "Tool block summaries");
	});

	it("fits pi's selector", () => {
		assert.equal(tidy("x".repeat(200)).length, MAX_CHARS);
	});

	it("keeps a name that is already fine", () => {
		assert.equal(tidy("重构 tool-blocks 的摘要"), "重构 tool-blocks 的摘要");
	});
});

describe("choosing who writes it", () => {
	const model = (id: string, input?: number) => ({ id, ...(input === undefined ? {} : { cost: { input } }) }) as never;

	it("prefers the pinned writer", () => {
		// Pinned for the same reason the tool-block summaries are: a name whose
		// voice changes because an account gained a model is worse than one
		// written by something weaker.
		assert.equal(pick([model("gpt-5-mini", 0.25), model(WRITER, 3)])?.id, WRITER);
	});

	it("falls back on price, so an account without it still gets a name", () => {
		assert.equal(pick([model("expensive", 9), model("cheap", 0.25)])?.id, "cheap");
	});

	it("takes what there is when nothing is priced", () => {
		assert.equal(pick([model("mystery")])?.id, "mystery");
		assert.equal(pick([]), undefined);
	});
});

describe("when there is nothing to name", () => {
	it("says nothing rather than inventing one", async () => {
		// A session nobody has spoken in has nothing to be named after.
		assert.equal(await nameFor(undefined, []), undefined);
		assert.equal(await nameFor(registryReturning("Anything"), []), undefined);
	});

	it("says nothing when there is no model to ask", async () => {
		assert.equal(await nameFor({ getAvailable: () => [] } as never, [said("user", "hi")]), undefined);
	});

	it("says nothing when the model returns an empty string", async () => {
		assert.equal(await nameFor(registryReturning("   "), [said("user", "hi")]), undefined);
	});

	it("returns the name when one comes back", async () => {
		assert.equal(await nameFor(registryReturning(' "Naming sessions" '), [said("user", "hi")]), "Naming sessions");
	});
});

/** A registry whose one model answers with `text`. */
function registryReturning(text: string) {
	return {
		getAvailable: () => [{ id: WRITER, cost: { input: 3 } }],
		complete: async () => ({ content: [{ type: "text", text }] }),
	} as never;
}
