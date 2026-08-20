/**
 * Contracts with pi that the type system cannot express.
 *
 * Run: pnpm test
 *
 * cd.test.ts covers the copy logic with the slot factory stubbed. This covers
 * the real factory, and the one behaviour /cd depends on that no signature
 * states: that asking pi for a session slot does not create the file.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";

describe("SessionManager", () => {
	it("assigns a session slot without writing it", () => {
		const agent = mkdtempSync(join(tmpdir(), "cd-contract-"));
		const previous = process.env.PI_CODING_AGENT_DIR;
		try {
			process.env.PI_CODING_AGENT_DIR = agent;
			const work = join(agent, "work");
			const sm = SessionManager.create(work);
			const file = sm.getSessionFile();

			assert.ok(file, "pi did not assign a session file");
			assert.ok(file.endsWith(".jsonl"), `expected a .jsonl path, got ${file}`);
			assert.equal(sm.getCwd(), work);
			assert.ok(sm.getSessionId().length > 0, "no session id");
			// /cd writes the copy itself, so pi must not have created the file.
			assert.ok(!existsSync(file), "create() wrote a file; /cd would clobber it");
			// The encoded directory name is what /cd relies on pi to compute.
			assert.ok(file.includes(join("sessions", "--")), `unexpected session dir layout: ${file}`);

			// /cd stopped passing parentSession because it changes nothing here and
			// only lands in the header, where the iOS client cannot read it. If pi
			// ever starts using it to place a session, this fails rather than
			// quietly putting relocated sessions somewhere else.
			const linked = SessionManager.create(work, undefined, { parentSession: "/parent.jsonl" });
			assert.equal(dirname(linked.getSessionFile()!), dirname(file), "parentSession moved the session");
			assert.equal(linked.getCwd(), sm.getCwd());
			assert.notEqual(linked.getSessionId(), sm.getSessionId(), "ids should still be unique");
		} finally {
			// Assigning undefined would set the string "undefined" and send every
			// later lookup into a directory of that name.
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
			rmSync(agent, { recursive: true, force: true });
		}
	});
});
