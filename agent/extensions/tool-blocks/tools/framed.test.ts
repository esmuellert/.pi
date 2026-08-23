import assert from "node:assert/strict";
import { sep } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { initTheme } from "@earendil-works/pi-coding-agent";

import { blank, plain } from "../shared/ansi.ts";
import { present } from "./override.ts";

initTheme("rose-pine");

const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const DIST = `${entry.slice(0, entry.indexOf(`${sep}dist${sep}`))}/dist`;
const { ToolExecutionComponent } = (await import(
	`${DIST}/modes/interactive/components/tool-execution.js`
)) as { ToolExecutionComponent: new (...a: unknown[]) => Block };

type Block = {
	setArgsComplete(): void;
	updateResult(result: unknown, partial: boolean): void;
	render(width: number): string[];
};

const NOTE = "removed the divider prop";
const WIDTH = 56;
const DIFF = ["  30      <p>", "- 31        const { divider } = props;", "+ 31        const [d, setD] = useState(50);"].join("\n");

/** A real block: pi's component, pi's frame, our presentation. */
function block(tool: string, args: object, details: unknown): string[] {
	const definition = present(tool as never, process.cwd(), { footnote: () => [NOTE] });
	const ui = { requestRender: () => {}, invalidate: () => {} };
	const component = new ToolExecutionComponent(tool, "id", args, { showImages: false }, definition, ui, process.cwd());
	component.setArgsComplete();
	component.updateResult({ content: [{ type: "text", text: "Successfully replaced 1 block(s)" }], details, isError: false }, false);
	return component.render(WIDTH);
}

/** Where the note landed, and what the line around it looks like. */
function note(lines: string[]) {
	const index = lines.findIndex((line) => plain(line).includes(NOTE));
	return {
		index,
		line: lines[index],
		background: /^(?:\u001b\[[0-9;]*m)*?\u001b\[48[;0-9]*m/.test(lines[index] ?? ""),
		indent: plain(lines[index] ?? "").length - plain(lines[index] ?? "").trimStart().length,
		trailing: lines.slice(index + 1).every(blank),
	};
}

describe("a footnote on a tool that frames itself", () => {
	it("lands inside the frame, like one on a tool that does not", () => {
		// `edit` declares renderShell "self" and draws its whole block from
		// renderCall, reading what renderResult left in `context.state`; its own
		// renderResult contributes no lines at all. A note appended there was
		// appended to nothing, and drew at column zero on the terminal's own
		// background, below the block rather than in it.
		const framed = note(block("edit", { path: "a.tsx", edits: [{ oldText: "a", newText: "b" }] }, { diff: DIFF, patch: DIFF }));
		const boxed = note(block("bash", { command: "echo hi" }, undefined));

		for (const [name, found] of [["edit", framed], ["bash", boxed]] as const) {
			assert.ok(found.index >= 0, `${name} lost the note`);
			assert.ok(found.background, `${name} drew the note outside the block's background`);
			assert.equal(found.indent, boxed.indent, `${name} drew the note at a different indent`);
			assert.ok(found.trailing, `${name} drew the note before the end of the block`);
		}
	});

	it("keeps the block's own lines", () => {
		// The note is inserted, not substituted: the diff has to survive it.
		const lines = block("edit", { path: "a.tsx", edits: [{ oldText: "a", newText: "b" }] }, { diff: DIFF, patch: DIFF });
		const text = lines.map(plain).join("\n");
		for (const wanted of ["edit a.tsx", "const { divider } = props;", "useState(50)"]) {
			assert.ok(text.includes(wanted), `lost ${JSON.stringify(wanted)}`);
		}
	});
});
