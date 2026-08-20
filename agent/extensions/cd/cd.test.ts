/**
 * Run: npm test
 *
 * Covers the pure relocation logic. The one pi-dependent piece — asking pi
 * where a session for a cwd belongs — is stubbed, so these run without pi's
 * module graph. index.ts wires the real SessionManager into the same seam.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { relocateSession, resolveTarget, type SessionSlotFactory } from "./relocate.ts";

const VERSION = 3;

describe("target resolution", () => {
	const base = mkdtempSync(join(tmpdir(), "cd-base-"));
	const sub = join(base, "sub");
	mkdirSync(sub);

	it("rejects blanks, missing paths and files", () => {
		assert.ok("error" in resolveTarget("", base));
		assert.ok("error" in resolveTarget("   ", base));
		assert.ok("error" in resolveTarget(join(base, "nope"), base));
		const file = join(base, "f.txt");
		writeFileSync(file, "x");
		assert.ok("error" in resolveTarget(file, base));
	});

	it("accepts absolute and relative paths, and strips quotes", () => {
		assert.deepEqual(resolveTarget(sub, base), { path: resolve(sub) });
		assert.deepEqual(resolveTarget("sub", base), { path: resolve(sub) });
		assert.deepEqual(resolveTarget(`"${sub}"`, base), { path: resolve(sub) });
		assert.deepEqual(resolveTarget(` ${sub} `, base), { path: resolve(sub) });
	});
});

describe("relocateSession", () => {
	const root = mkdtempSync(join(tmpdir(), "cd-reloc-"));
	const target = join(root, "target");
	mkdirSync(target);

	let served = 0;
	const stubSlot: SessionSlotFactory = (cwd, parent) => {
		served++;
		assert.ok(parent.length > 0, "factory must receive the source path");
		return { file: join(root, "store", `s${served}.jsonl`), id: `new-id-${served}`, cwd: resolve(cwd) };
	};

	const header = { type: "session", version: 3, id: "old-id", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/old" };
	const body = [JSON.stringify(header), JSON.stringify({ type: "message", id: "m1", parentId: null }), ""];
	const src = join(root, "src.jsonl");
	writeFileSync(src, body.join("\n"));

	it("rewrites only the header", () => {
		const out = relocateSession(src, target, stubSlot, VERSION);
		const lines = readFileSync(out, "utf-8").split("\n");
		const written = JSON.parse(lines[0]);

		assert.equal(written.cwd, resolve(target));
		assert.equal(written.parentSession, src);
		assert.notEqual(written.id, "old-id", "a copy must not reuse the session id");
		assert.equal(written.version, VERSION);
		assert.equal(written.type, "session");
		assert.deepEqual(lines.slice(1), body.slice(1), "history must survive byte for byte");
	});

	it("writes to the slot pi assigned, creating the directory", () => {
		const out = relocateSession(src, target, stubSlot, VERSION);
		assert.ok(out.startsWith(join(root, "store")), out);
	});

	it("leaves no .partial file behind", () => {
		relocateSession(src, target, stubSlot, VERSION);
		assert.ok(!readdirSync(join(root, "store")).some((f) => f.endsWith(".partial")));
	});

	it("preserves unknown header fields it does not own", () => {
		const rich = join(root, "rich.jsonl");
		writeFileSync(rich, `${JSON.stringify({ ...header, customField: "keep me" })}\n`);
		const out = relocateSession(rich, target, stubSlot, VERSION);
		assert.equal(JSON.parse(readFileSync(out, "utf-8").split("\n")[0]).customField, "keep me");
	});

	it("tolerates leading blank lines before the header", () => {
		const padded = join(root, "padded.jsonl");
		writeFileSync(padded, `\n\n${body.join("\n")}`);
		const out = relocateSession(padded, target, stubSlot, VERSION);
		assert.equal(JSON.parse(readFileSync(out, "utf-8").split("\n")[2]).cwd, resolve(target));
	});

	it("refuses a file whose first entry is not a session header", () => {
		const bad = join(root, "bad.jsonl");
		writeFileSync(bad, `${JSON.stringify({ type: "message" })}\n`);
		assert.throws(() => relocateSession(bad, target, stubSlot, VERSION), /not a session header/);
	});

	it("refuses an empty file", () => {
		const empty = join(root, "empty.jsonl");
		writeFileSync(empty, "\n\n");
		assert.throws(() => relocateSession(empty, target, stubSlot, VERSION), /empty/);
	});
});
