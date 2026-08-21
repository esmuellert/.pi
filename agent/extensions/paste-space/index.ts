/**
 * Keep a pasted path from growing onto the one before it.
 *
 * Pasting an image writes a temp file and inserts its path at the cursor:
 *
 *     this.editor.insertTextAtCursor?.(filePath);
 *
 * Nothing looks at what is already there, so two pastes in a row produce
 *
 *     /tmp/pi-clipboard-e58….png/tmp/moshi-paste-384….jpg
 *
 * and both paths are ruined -- the first grew a tail, the second lost its
 * head. It is not one terminal or one client: every path into the editor ends
 * at the same method, and none of them spaces anything.
 *
 * This wraps that method rather than replacing the editor, so everything that
 * inserts is covered and nothing about the editor changes.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { separated } from "./separate.ts";

/** Marks an editor already wrapped, so a re-entered session does not stack wrappers. */
const WRAPPED = Symbol.for("pi-config/paste-space");

type Editor = {
	insertTextAtCursor?(text: string): void;
	getLines?(): string[];
	getCursor?(): { line: number; col: number };
	[WRAPPED]?: boolean;
};

/**
 * The line the cursor sits on, split where it sits.
 *
 * Only that line matters. pi's own insertion works on
 * `state.lines[cursorLine]` sliced at `cursorCol`, so anything wider than the
 * line would be answering a different question than the one being asked.
 */
export function around(editor: Editor): { before: string; after: string } | undefined {
	const cursor = editor.getCursor?.();
	const lines = editor.getLines?.();
	if (!cursor || !lines) return undefined;
	const line = lines[cursor.line];
	if (typeof line !== "string") return undefined;
	return { before: line.slice(0, cursor.col), after: line.slice(cursor.col) };
}

/**
 * Wrap `insertTextAtCursor` so what it inserts is spaced from its neighbours.
 *
 * Returns whether it did. A missing method means pi changed the editor, which
 * is worth hearing about rather than silently doing nothing.
 */
export function wrap(editor: Editor): boolean {
	if (editor[WRAPPED]) return true;
	const original = editor.insertTextAtCursor;
	if (typeof original !== "function") return false;

	editor.insertTextAtCursor = function (text: string) {
		const at = around(this);
		// Without knowing what the insertion lands between, insert exactly what
		// was asked for. Doing nothing is the safe failure here.
		original.call(this, at ? separated(text, at) : text);
	};
	editor[WRAPPED] = true;
	return true;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		if (ctx.mode !== "tui") return;

		// A widget factory is the only place an extension is handed the TUI. The
		// editor is whatever it has focused, since pi focuses it on startup and
		// returns focus to it after every dialog.
		let wrapped: boolean | undefined;
		ctx.ui.setWidget("paste-space", (tui) => {
			const editor = (tui as { getFocusedComponent?(): Editor }).getFocusedComponent?.();
			wrapped = editor ? wrap(editor) : false;
			return { render: () => [], invalidate() {} };
		});
		ctx.ui.setWidget("paste-space", undefined);

		if (wrapped === false) {
			ctx.ui.notify("paste-space: no editor to wrap; pasted paths may run together", "warning");
		}
	});
}
