/**
 * The rules that decide whether a block gets a sentence, and how often.
 *
 * Run: pnpm test
 *
 * Every one of these was a bug first. There is no rule about which commands
 * deserve a sentence: two were written, one wrong, and both were one more thing
 * to get wrong.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	pick,
	ask,
	argsAsText,
	LANGUAGE_RULE,
	sample,
	INSTRUCTION,
	type Slot,
	summaryFor,
	WRITER,
	tidy,
	useRegistry,
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
const OUTPUT = "wrote 3 files";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("when a sentence is asked for", () => {
	it("asks once, however many times the block is drawn", async () => {
		const { registry, asked } = stubRegistry();
		useRegistry(registry as never);
		const slot: Slot = {};
		const command = "cat > f <<'EOF'\nbody\nEOF";
		for (let draw = 0; draw < 5; draw += 1) summaryFor("bash", command, OUTPUT, slot, () => {});
		await settle();
		for (let draw = 0; draw < 5; draw += 1) summaryFor("bash", command, OUTPUT, slot, () => {});
		assert.equal(asked.length, 1);
	});

	it("asks again when the command itself changes", async () => {
		const { registry, asked } = stubRegistry();
		useRegistry(registry as never);
		const slot: Slot = {};
		summaryFor("bash", "cat > a <<'EOF'\nx\nEOF", OUTPUT, slot, () => {});
		await settle();
		summaryFor("bash", "cat > b <<'EOF'\ny\nEOF", OUTPUT, slot, () => {});
		await settle();
		assert.equal(asked.length, 2);
	});

	it("sends the whole command and the whole output", () => {
		// Truncating loses exactly the part a long command needs summarising for.
		const command = `head
${"x".repeat(20_000)}`;
		const output = "y".repeat(20_000);
		const body = ask("bash", { command }, output);
		assert.ok(body.startsWith(INSTRUCTION));
		assert.ok(body.includes(command), "the command should arrive whole");
		assert.ok(body.includes(output), "the output should arrive whole");
	});
});

describe("what comes back", () => {
	it("redraws the block once the sentence has arrived", async () => {
		const { registry } = stubRegistry();
		useRegistry(registry as never);
		let redraws = 0;
		const slot: Slot = {};
		const command = "cat > f <<'EOF'\nbody\nEOF";
		assert.equal(summaryFor("bash", command, OUTPUT, slot, () => { redraws += 1; }), undefined);
		await settle();
		assert.equal(redraws, 1);
		assert.equal(summaryFor("bash", command, OUTPUT, slot, () => {}), "generates test data");
	});

	it("gives up quietly when the model fails", async () => {
		const registry = {
			getAvailable: () => [{ id: WRITER, provider: "github-copilot" }],
			complete: async () => { throw new Error("no"); },
		};
		useRegistry(registry as never);
		const slot: Slot = {};
		const command = "cat > f <<'EOF'\nbody\nEOF";
		summaryFor("bash", command, OUTPUT, slot, () => {});
		await settle();
		// Undefined means the line is simply absent, not an error in the block.
		assert.equal(summaryFor("bash", command, OUTPUT, slot, () => {}), undefined);
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
		summaryFor("bash", command, OUTPUT, slot, () => {});
		await settle();
		for (let draw = 0; draw < 3; draw += 1) summaryFor("bash", command, OUTPUT, slot, () => {});
		await settle();
		assert.equal(calls, 1);
	});

	it("says nothing when there is no model to ask", () => {
		useRegistry(undefined);
		assert.equal(summaryFor("bash", "cat > f <<'EOF'\nx\nEOF", OUTPUT, {}, () => {}), undefined);
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

describe("the language it writes in", () => {
	/** A session holding the given user messages, newest last. */
	const spoke = (...said: string[]) => ({
		getBranch: () => said.map((text) => ({ type: "message", message: { role: "user", content: text } })),
	});

	it("shows the writer what the reader wrote", () => {
		// Not as context -- the conversation scored worst of seven shapes -- but
		// as something to read a language off. Detecting it here would mean
		// writing a detector, and the one worth writing calls Spanish, French,
		// German and Russian all English.
		const body = ask("bash", "ls", "a b", "为什么刚才代码没了？");
		assert.ok(body.includes(LANGUAGE_RULE));
		assert.match(body, /THE READER WRITES LIKE THIS:\n为什么/);
	});

	it("leaves the rule out when there is nothing to read", () => {
		const body = ask("bash", "ls", "a b", "   ");
		assert.ok(!body.includes(LANGUAGE_RULE));
		assert.doesNotMatch(body, /THE READER/);
	});

	it("takes the last messages, in the order they were written", () => {
		assert.equal(sample(spoke("first", "second", "third")), "second\nthird");
	});

	it("ignores the assistant and the tools", () => {
		const mixed = {
			getBranch: () => [
				{ type: "message", message: { role: "user", content: "mine" } },
				{ type: "message", message: { role: "assistant", content: "not mine" } },
				{ type: "compaction" },
			],
		};
		assert.equal(sample(mixed as never), "mine");
	});

	it("reads text out of a content array", () => {
		const rich = {
			getBranch: () => [{
				type: "message",
				message: { role: "user", content: [{ type: "text", text: "typed" }, { type: "image" }] },
			}],
		};
		assert.equal(sample(rich as never), "typed");
	});

	it("says nothing when there is no session", () => {
		assert.equal(sample(undefined), "");
	});
});
