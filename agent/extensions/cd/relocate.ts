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

export type SessionSlotFactory = (cwd: string, parentSession: string) => SessionSlot;

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

	const slot = makeSlot(targetCwd, sourceFile);
	lines[headerLine] = JSON.stringify({
		...original,
		type: "session",
		version: sessionVersion,
		id: slot.id,
		timestamp: new Date().toISOString(),
		cwd: slot.cwd,
		parentSession: sourceFile,
	});

	mkdirSync(dirname(slot.file), { recursive: true });
	const tmp = `${slot.file}.partial`;
	writeFileSync(tmp, lines.join("\n"), "utf-8");
	renameSync(tmp, slot.file);
	return slot.file;
}
