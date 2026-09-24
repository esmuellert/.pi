import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { installModelShortcuts, MODEL_SHORTCUTS } from "./index.ts";

function harness(availableModels = MODEL_SHORTCUTS) {
	const shortcuts = new Map<string, { handler: (ctx: any) => Promise<void> }>();
	const modelChanges: string[] = [];
	const thinkingChanges: string[] = [];
	const notices: string[] = [];
	const models = new Map(availableModels.map((shortcut) => [
		`${shortcut.provider}/${shortcut.model}`,
		{ provider: shortcut.provider, id: shortcut.model },
	]));
	const pi = {
		registerShortcut(key: string, options: { handler: (ctx: any) => Promise<void> }) {
			shortcuts.set(key, options);
		},
		setModel: async (model: { provider: string; id: string }) => {
			modelChanges.push(`${model.provider}/${model.id}`);
			return true;
		},
		setThinkingLevel(level: string) {
			thinkingChanges.push(level);
		},
	} as any;
	const ctx = {
		modelRegistry: { find: (provider: string, model: string) => models.get(`${provider}/${model}`) },
		ui: { notify: (message: string) => notices.push(message) },
	};
	installModelShortcuts(pi);
	return { shortcuts, modelChanges, thinkingChanges, notices, ctx };
}

describe("model shortcuts", () => {
	const expected = [
		["alt+1", "github-copilot/gpt-6-astra"],
		["alt+2", "github-copilot/gpt-6-sol"],
		["alt+3", "github-copilot/gpt-6-luna"],
		["alt+4", "openai-codex/gpt-6-astra"],
		["alt+5", "openai-codex/gpt-6-sol"],
		["alt+6", "openai-codex/gpt-6-luna"],
		["alt+7", "github-copilot/claude-opus-5.5"],
	] as const;

	it("registers the seven requested shortcuts in order", () => {
		const app = harness();
		assert.deepEqual([...app.shortcuts.keys()], expected.map(([key]) => key));
	});

	for (const [key, model] of expected) {
		it(`${key} selects ${model} at max thinking`, async () => {
			const app = harness();
			await app.shortcuts.get(key)!.handler(app.ctx);
			assert.deepEqual(app.modelChanges, [model]);
			assert.deepEqual(app.thinkingChanges, ["max"]);
			assert.deepEqual(app.notices, [`Model: ${model}:max`]);
		});
	}

	it("reports an unavailable model without changing the session", async () => {
		const app = harness(MODEL_SHORTCUTS.slice(1));
		await app.shortcuts.get("alt+1")!.handler(app.ctx);
		assert.deepEqual(app.modelChanges, []);
		assert.deepEqual(app.thinkingChanges, []);
		assert.deepEqual(app.notices, ["alt+1: github-copilot/gpt-6-astra:max is unavailable"]);
	});
});
