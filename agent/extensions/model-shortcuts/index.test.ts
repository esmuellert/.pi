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
	it("registers the six requested shortcuts in order", () => {
		const app = harness();
		assert.deepEqual([...app.shortcuts.keys()], [
			"ctrl+1", "alt+1", "ctrl+2", "alt+2", "ctrl+3", "alt+3",
			"ctrl+4", "alt+4", "ctrl+5", "alt+5", "ctrl+6", "alt+6",
		]);
	});

	it("selects the mapped model and thinking level", async () => {
		const app = harness();
		await app.shortcuts.get("alt+6")!.handler(app.ctx);
		assert.deepEqual(app.modelChanges, ["openai-codex/gpt-5.6-luna"]);
		assert.deepEqual(app.thinkingChanges, ["max"]);
		assert.deepEqual(app.notices, ["Model: openai-codex/gpt-5.6-luna:max"]);
	});

	it("reports an unavailable model without changing the session", async () => {
		const app = harness(MODEL_SHORTCUTS.slice(1));
		await app.shortcuts.get("ctrl+1")!.handler(app.ctx);
		assert.deepEqual(app.modelChanges, []);
		assert.deepEqual(app.thinkingChanges, []);
		assert.deepEqual(app.notices, ["ctrl+1: github-copilot/gpt-6-astra:max is unavailable"]);
	});
});
