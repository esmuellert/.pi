import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function fakeProvider(pi: ExtensionAPI): void {
	pi.registerProvider("e2e", {
		name: "Pi upgrade restart E2E",
		baseUrl: "http://127.0.0.1:3210/v1",
		apiKey: "e2e",
		api: "openai-completions",
		models: [
			{
				id: "fake",
				name: "Pi upgrade restart fake model",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 32_000,
				maxTokens: 1_024,
			},
		],
	});
}
