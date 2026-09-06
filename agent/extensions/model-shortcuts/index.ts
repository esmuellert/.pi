import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
type ShortcutKey = Parameters<ExtensionAPI["registerShortcut"]>[0];

export interface ModelShortcut {
	key: ShortcutKey;
	provider: string;
	model: string;
	thinkingLevel: ThinkingLevel;
}

export const MODEL_SHORTCUTS: readonly ModelShortcut[] = [
	{ key: "alt+1", provider: "github-copilot", model: "gpt-6-astra", thinkingLevel: "max" },
	{ key: "alt+2", provider: "github-copilot", model: "gpt-5.6-sol", thinkingLevel: "max" },
	{ key: "alt+3", provider: "github-copilot", model: "gpt-5.6-luna", thinkingLevel: "max" },
	{ key: "alt+4", provider: "openai-codex", model: "gpt-6-astra", thinkingLevel: "max" },
	{ key: "alt+5", provider: "openai-codex", model: "gpt-5.6-sol", thinkingLevel: "max" },
	{ key: "alt+6", provider: "openai-codex", model: "gpt-5.6-luna", thinkingLevel: "max" },
];

function modelLabel(shortcut: ModelShortcut): string {
	return `${shortcut.provider}/${shortcut.model}:${shortcut.thinkingLevel}`;
}

export function installModelShortcuts(
	pi: ExtensionAPI,
	shortcuts: readonly ModelShortcut[] = MODEL_SHORTCUTS,
): void {
	for (const shortcut of shortcuts) {
		const handler = async (ctx: ExtensionContext) => {
			const model = ctx.modelRegistry.find(shortcut.provider, shortcut.model);
			if (!model) {
				ctx.ui.notify(`${shortcut.key}: ${modelLabel(shortcut)} is unavailable`, "error");
				return;
			}
			if (!await pi.setModel(model)) {
				ctx.ui.notify(`${shortcut.key}: authentication unavailable for ${modelLabel(shortcut)}`, "error");
				return;
			}
			pi.setThinkingLevel(shortcut.thinkingLevel);
			ctx.ui.notify(`Model: ${modelLabel(shortcut)}`, "info");
		};
		pi.registerShortcut(shortcut.key, {
			description: `Switch to ${modelLabel(shortcut)}`,
			handler,
		});
	}
}

export default function modelShortcuts(pi: ExtensionAPI): void {
	installModelShortcuts(pi);
}
