/**
 * Pure relocation logic. No pi imports, so it can be unit tested directly.
 *
 * The one piece that must come from pi — where a session for a given cwd
 * belongs on disk — is injected as a `SessionSlotFactory`.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** Where a relocated session should be written, as computed by pi. */
export interface SessionSlot {
	file: string;
	id: string;
	cwd: string;
}

export type SessionSlotFactory = (cwd: string) => SessionSlot;

/** Expand ~, resolve against `base`, and require an existing directory. */
export function resolveTarget(input: string, base: string): { path: string } | { error: string } {
	const raw = input.trim().replace(/^["']|["']$/g, "");
	if (!raw) return { error: "Usage: /cd <directory>" };
	const expanded = raw === "~" || raw.startsWith("~/") ? join(homedir(), raw.slice(1)) : raw;
	const path = isAbsolute(expanded) ? resolve(expanded) : resolve(base, expanded);
	if (!existsSync(path)) return { error: `No such directory: ${path}` };
	if (!statSync(path).isDirectory()) return { error: `Not a directory: ${path}` };
	return { path };
}

/**
 * Copy `sourceFile` into the slot pi assigns for `targetCwd`, replacing only the
 * header. Every other line is carried across byte for byte, so entry ids,
 * parent links and timestamps stay exactly as they were.
 *
 * The header does not record where the session came from. pi does not need it —
 * the slot it assigns is the same with or without a parentSession — and the iOS
 * client chokes on the key, so a relocated session is a session in its own
 * right. A parentSession left over from an earlier move is dropped too, which
 * spreading the original header would otherwise carry forward.
 *
 * Written to a temporary name first: a crash mid-write would otherwise leave a
 * truncated session that pi would try to load.
 */
export function relocateSession(
	sourceFile: string,
	targetCwd: string,
	makeSlot: SessionSlotFactory,
	sessionVersion: number,
): string {
	const lines = readFileSync(sourceFile, "utf-8").split("\n");
	const headerLine = lines.findIndex((l) => l.trim().length > 0);
	if (headerLine === -1) throw new Error("Session file is empty");

	const original = JSON.parse(lines[headerLine]);
	if (original?.type !== "session") throw new Error("First entry is not a session header");

	const slot = makeSlot(targetCwd);
	const { parentSession: _dropped, ...carried } = original;
	lines[headerLine] = JSON.stringify({
		...carried,
		type: "session",
		version: sessionVersion,
		id: slot.id,
		timestamp: new Date().toISOString(),
		cwd: slot.cwd,
	});

	mkdirSync(dirname(slot.file), { recursive: true });
	const tmp = `${slot.file}.partial`;
	writeFileSync(tmp, lines.join("\n"), "utf-8");
	renameSync(tmp, slot.file);
	return slot.file;
}
