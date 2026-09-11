import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampCompactionEffort, installCompactionEffort } from "./index.ts";

type Handler = (event: any, ctx?: any) => unknown;

function harness() {
	const handlers = new Map<string, Handler[]>();
	const pi = {
		on(name: string, handler: Handler) {
			const registered = handlers.get(name) ?? [];
			registered.push(handler);
			handlers.set(name, registered);
		},
	} as any;
	installCompactionEffort(pi);
	return {
		emit(name: string, event: any = {}) {
			let result: unknown;
			for (const handler of handlers.get(name) ?? []) {
				const next = handler(event, {});
				if (next !== undefined) result = next;
			}
			return result;
		},
	};
}

describe("compaction effort payloads", () => {
	it("clamps OpenAI Responses effort without losing sibling fields", () => {
		const input = {
			model: "gpt-6-astra",
			reasoning: { effort: "max", summary: "auto" },
			input: [{ role: "user", content: "summarize" }],
		};
		const result = clampCompactionEffort(input);
		assert.deepEqual(result, {
			...input,
			reasoning: { effort: "low", summary: "auto" },
		});
		assert.deepEqual(input.reasoning, { effort: "max", summary: "auto" });
	});

	it("clamps equivalent completions and adaptive-thinking fields", () => {
		assert.deepEqual(
			clampCompactionEffort({
				reasoning_effort: "high",
				output_config: { effort: "xhigh", format: { type: "text" } },
			}),
			{
				reasoning_effort: "low",
				output_config: { effort: "low", format: { type: "text" } },
			},
		);
	});

	it("does not add or raise reasoning", () => {
		for (const input of [
			{ model: "plain" },
			{ reasoning: { effort: "low" } },
			{ reasoning: { effort: "minimal" } },
			{ reasoning: { effort: "off" } },
			{ reasoning_effort: "none" },
			null,
			["not", "a", "payload"],
		]) {
			assert.strictEqual(clampCompactionEffort(input), input);
		}
	});
});

describe("compaction lifecycle", () => {
	it("clamps every request inside a compaction and no request outside it", () => {
		const app = harness();
		const request = () => app.emit("before_provider_request", {
			payload: { reasoning: { effort: "max" } },
		});

		assert.equal(request(), undefined);
		app.emit("session_before_compact");
		assert.deepEqual(request(), { reasoning: { effort: "low" } });
		assert.deepEqual(request(), { reasoning: { effort: "low" } });
		app.emit("session_compact");
		assert.equal(request(), undefined);
	});

	it("clears state after failure and session shutdown", () => {
		for (const terminalEvent of ["session_compact_failed", "session_shutdown"]) {
			const app = harness();
			app.emit("session_before_compact");
			app.emit(terminalEvent);
			assert.equal(app.emit("before_provider_request", {
				payload: { reasoning_effort: "max" },
			}), undefined);
		}
	});
});
