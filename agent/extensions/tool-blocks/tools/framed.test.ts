import assert from "node:assert/strict";
import { sep } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { initTheme } from "@earendil-works/pi-coding-agent";

import { blank, plain } from "../shared/ansi.ts";
import { TOOLS, type ToolName } from "./builtins.ts";
import { present } from "./override.ts";

initTheme("rose-pine");

const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const DIST = `${entry.slice(0, entry.indexOf(`${sep}dist${sep}`))}/dist`;
// pathToFileURL, because import() takes a URL: a bare Windows path puts the
// drive letter where the scheme belongs and Node rejects it as protocol 'c:'.
const { ToolExecutionComponent } = (await import(
	pathToFileURL(`${DIST}/modes/interactive/components/tool-execution.js`).href
)) as { ToolExecutionComponent: new (...a: unknown[]) => Block };

type Block = {
	setArgsComplete(): void;
	updateResult(result: unknown, partial: boolean): void;
	render(width: number): string[];
};

const NOTE = "removed the divider prop";
const WIDTH = 56;

/** OSC 8 opener and closer, so a linked path reads as the text it draws. */
const OSC8 = /\u001b\]8;[^;]*;[^\u001b\u0007]*(?:\u001b\\|\u0007)/g;
const unlinked = (line: string): string => plain(line).replace(OSC8, "");

const DIFF = "  30      <p>\n- 31        const { divider } = props;\n+ 31        const [d, setD] = useState(50);";

const ARGS: Readonly<Record<ToolName, object>> = {
	read: { path: "a.ts" },
	bash: { command: "echo hi" },
	edit: { path: "a.ts", edits: [{ oldText: "a", newText: "b" }] },
	write: { path: "a.ts", content: "x\n" },
	ls: { path: "." },
	grep: { pattern: "divider" },
	find: { pattern: "*.ts" },
};

const OUTPUT: Readonly<Partial<Record<ToolName, string>>> = {
	read: "  1  const { divider } = props;",
	ls: "a.ts\nb.ts",
	grep: "a.ts:31:const { divider } = props;",
	find: "a.ts",
};

/** A real block: pi's component, pi's frame, our presentation. */
function block(tool: ToolName): string[] {
	const definition = present(tool, process.cwd(), { footnote: () => [NOTE] });
	const ui = { requestRender: () => {}, invalidate: () => {} };
	const component = new ToolExecutionComponent(tool, "id", ARGS[tool], { showImages: false }, definition, ui, process.cwd());
	component.setArgsComplete();
	component.updateResult(
		{
			content: [{ type: "text", text: OUTPUT[tool] ?? "Successfully replaced 1 block(s)" }],
			details: tool === "edit" ? { diff: DIFF, patch: DIFF } : undefined,
			isError: false,
		},
		false,
	);
	return component.render(WIDTH);
}

/** Where the note landed, and what the line around it looks like. */
function note(lines: string[]) {
	const index = lines.findIndex((line) => plain(line).includes(NOTE));
	const line = lines[index] ?? "";
	return {
		index,
		background: /^(?:\u001b\[[0-9;]*m)*?\u001b\[48[;0-9]*m/.test(line),
		indent: plain(line).length - plain(line).trimStart().length,
		last: index >= 0 && lines.slice(index + 1).every(blank),
	};
}

describe("where a footnote lands", () => {
	it("is inside the block, for every tool", () => {
		// `edit` declares renderShell "self" and draws its whole block from
		// renderCall, reading what renderResult left in `context.state`; its own
		// renderResult contributes no lines at all. A note appended there was
		// appended to nothing, and drew at column zero on the terminal's own
		// background, below the block rather than in it.
		//
		// Every tool is checked rather than the one that broke, because the fix
		// assumes a self-framing tool keeps its frame in renderCall -- true of
		// edit, and worth failing loudly for anything that arrives later.
		const boxed = note(block("bash"));
		for (const tool of TOOLS) {
			const found = note(block(tool));
			assert.ok(found.index >= 0, `${tool} lost the note`);
			assert.ok(found.background, `${tool} drew the note outside the block's background`);
			assert.equal(found.indent, boxed.indent, `${tool} drew the note at a different indent`);
			assert.ok(found.last, `${tool} drew the note before the end of the block`);
		}
	});

	it("does not displace what the block already drew", () => {
		// The note is inserted, not substituted: the diff has to survive it.
		//
		// Links are dropped first. `plain` keeps OSC 8 on purpose, because a
		// title's path is clickable and stripping it would throw the link away --
		// but that leaves the URI sitting between `edit` and `a.ts`, which no
		// reader sees and a substring search trips over.
		const text = block("edit").map(unlinked).join("\n");
		for (const wanted of ["edit a.ts", "const { divider } = props;", "useState(50)"]) {
			assert.ok(text.includes(wanted), `lost ${JSON.stringify(wanted)}`);
		}
	});
});
