/**
 * What must be true by the time the extension has finished loading.
 *
 * Run: pnpm test
 *
 * renderCall is synchronous, so a highlighter that arrives after the transcript
 * has been drawn is never used: nothing draws it again. Firing preparation off
 * and not awaiting it looked fine on a fresh start, where the first command is
 * seconds away, and failed on /reload, where the whole transcript redraws
 * immediately and then stands still.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ready } from "./bash/engine.ts";
import extension from "./index.ts";

/** The parts of ExtensionAPI this extension touches. */
function stubPi() {
	const tools: string[] = [];
	const commands: string[] = [];
	return {
		tools,
		commands,
		api: {
			registerTool: (tool: { name: string }) => {
				// The highlighter must already be usable: pi may draw the very
				// next frame, and renderCall cannot wait.
				assert.ok(ready(), `${tool.name} was registered before the highlighter was ready`);
				tools.push(tool.name);
			},
			registerCommand: (name: string) => commands.push(name),
		} as never,
	};
}

describe("loading the extension", () => {
	it("has the highlighter ready before it registers anything", async () => {
		const { api, tools, commands } = stubPi();
		await extension(api);
		assert.equal(tools.length, 7, "every built-in tool should be taken over");
		assert.deepEqual(commands, ["tool-marks", "tool-frame"]);
	});

	it("returns a promise, so pi waits for it", () => {
		const { api } = stubPi();
		const returned = extension(api);
		assert.ok(returned instanceof Promise, "pi awaits the factory; a sync factory cannot prepare anything");
		return returned;
	});
});
