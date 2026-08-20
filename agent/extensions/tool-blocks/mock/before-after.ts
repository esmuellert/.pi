/**
 * Before and after, rendered by pi's own components.
 *
 * Not a drawing of a tool block -- an actual one. It builds pi's
 * ToolExecutionComponent with the real bash tool definition, the real theme
 * and the real background, and asks it to render. What appears here is what
 * would appear in the transcript.
 *
 * Run it in your own terminal: pi strips ANSI from command output, so colours
 * do not survive being run from inside pi.
 *
 *   cd ~/.pi/agent/extensions/tool-blocks
 *   node --experimental-strip-types mock/before-after.ts
 *
 *   MOCK_WIDTH=53               narrow, as on the phone
 *   MOCK_PICK=58,20             which fixture commands to show
 *   MOCK_THEME=catppuccin-mocha
 */
import { readFileSync } from "node:fs";
import { initTheme } from "@earendil-works/pi-coding-agent";

initTheme(process.env.MOCK_THEME ?? "rose-pine");

const DIST =
	"/home/dev/Library/pnpm/store/v11/links/@earendil-works/pi-coding-agent/0.84.2/686092e01fbe03c52bb154695b457edb230167c334e85339f4491e22bc1e8979/node_modules/@earendil-works/pi-coding-agent/dist";
const { ToolExecutionComponent } = await import(`${DIST}/modes/interactive/components/tool-execution.js`);
const { theme } = await import(`${DIST}/modes/interactive/theme/theme.js`);

const { prepare } = await import("../bash/engine.ts");
const { marking } = await import("../mark/index.ts");
const { present } = await import("../tools/override.ts");
const { retitling } = await import("../bash/title.ts");
await prepare();

const WIDTH = Number(process.env.MOCK_WIDTH ?? process.stdout.columns ?? 80);
const CWD = "/home/dev/repos/atlas";
const commands: string[] = JSON.parse(readFileSync("bash/fixtures/commands.json", "utf-8"));

/** The parts of pi's ui that a tool block reaches for while rendering. */
const ui = { requestRender: () => {}, invalidate: () => {} };

/** A real tool block: pi's component, pi's background, our tool definition. */
const block = (command: string, output: string, definition: unknown, expanded: boolean) => {
	const component = new (ToolExecutionComponent as never as new (...a: unknown[]) => {
		setArgsComplete(): void;
		updateResult(r: unknown, p: boolean): void;
		setExpanded(e: boolean): void;
		render(w: number): string[];
	})("bash", "mock-call", { command }, { showImages: false }, definition, ui, CWD);
	component.setArgsComplete();
	component.updateResult({ content: [{ type: "text", text: output }], isError: false }, false);
	component.setExpanded(expanded);
	return component.render(WIDTH);
};

const label = (text: string) => console.log("\n" + theme.fg("accent", text));
const draw = (lines: string[], cap = 999) => {
	for (const line of lines.slice(0, cap)) console.log(line);
	if (lines.length > cap) console.log(theme.fg("dim", `   ... ${lines.length - cap} more lines`));
};

const styles = ["count", "ellipsis", "lines", "plain"] as const;
const definitionFor = (style: (typeof styles)[number]) =>
	present("bash", CWD, { frame: marking("bash", () => "glyphs"), retitle: retitling(style) });
const today = definitionFor("count");

/** Real output shape: no leading indentation, which pi's renderer trims anyway. */
const OUTPUT = "Atlas/Sources/App.swift\nAtlas/Sources/Editor.swift\n3 files changed";

for (const index of (process.env.MOCK_PICK ?? "58,59").split(",").map(Number)) {
	const command = commands[index]!;

	// Today's rendering is the folded one asked to expand, which is what it
	// already does: the same lines, in the same order, wrapped the same way.
	const before = block(command, OUTPUT, today, true);

	// Which sample this is, how big it is, and at what width -- without it the
	// blocks below could be anything, and a one-line sample looks like a bug.
	const heading = ` #${index} · ${before.length} lines at ${WIDTH} columns `;
	const rule = "━".repeat(Math.max(0, WIDTH - heading.length - 2));
	console.log("\n" + theme.fg("accent", `━━${heading}${rule}`));

	label(`BEFORE  -  today`);
	draw(before, Number(process.env.MOCK_CAP ?? 16));
	console.log(theme.fg("dim", `        ${before.length} lines`));

	label(`AFTER   -  folded`);
	const after = block(command, OUTPUT, today, false);
	draw(after);
	console.log(theme.fg("dim", `        ${after.length} lines`));

	label(`AFTER   -  ctrl+o`);
	const opened = block(command, OUTPUT, today, true);
	draw(opened, Number(process.env.MOCK_CAP ?? 16));
	console.log(theme.fg("dim", `        ${opened.length} lines`));

	// Only the title line differs between these, so show just that line.
	label(`hint styles`);
	for (const style of styles) {
		const lines = block(command, OUTPUT, definitionFor(style), false);
		const titleLine = lines.find((l) => l.includes("$")) ?? "";
		console.log(theme.fg("dim", `  ${style.padEnd(9)}`) + titleLine.replace(/\s+$/, ""));
	}
}
