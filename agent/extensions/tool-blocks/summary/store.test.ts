import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { type Appender, type Branch, ENTRY_TYPE, forget, read, recall, remember, useSession } from "./store.ts";

/** A session file, as pi keeps one: entries appended, read back in order. */
function session() {
	const entries: { type?: string; customType?: string; data?: unknown }[] = [];
	const branch: Branch = { getBranch: () => entries };
	const appender: Appender = { appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }) };
	return { entries, branch, appender };
}

beforeEach(forget);

describe("sentences that outlive a render", () => {
	it("is there in the next run", () => {
		// context.state is cleared by rebuildChatFromMessages, which both
		// /reload and reopening a session call. This is what is not.
		const first = session();
		useSession(first.appender, first.branch);
		remember("call-1", "listed the extensions");

		useSession(first.appender, first.branch);
		assert.equal(recall("call-1"), "listed the extensions");
	});

	it("is keyed by the tool call, not by the command", () => {
		// Two runs of the same command are two things having happened. The id
		// is what pi already calls one block.
		const { appender, branch } = session();
		useSession(appender, branch);
		remember("call-1", "the first time");
		remember("call-2", "the second time");
		assert.equal(recall("call-1"), "the first time");
		assert.equal(recall("call-2"), "the second time");
	});

	it("writes one entry per sentence, of pi's custom type", () => {
		const { entries, appender, branch } = session();
		useSession(appender, branch);
		remember("call-1", "a note");
		assert.equal(entries.length, 1);
		assert.deepEqual(entries[0], { type: "custom", customType: ENTRY_TYPE, data: { id: "call-1", text: "a note" } });
	});

	it("survives an appender that refuses", () => {
		// pi rejects a write from an extension that is no longer active. The
		// sentence is still worth having for the rest of this run.
		const { branch } = session();
		useSession({ appendEntry: () => { throw new Error("not active"); } }, branch);
		assert.doesNotThrow(() => remember("call-1", "a note"));
		assert.equal(recall("call-1"), "a note");
	});

	it("ignores entries belonging to something else", () => {
		const entries = [
			{ type: "message" },
			{ type: "custom", customType: "someone-elses", data: { id: "call-1", text: "not mine" } },
			{ type: "custom", customType: ENTRY_TYPE, data: { id: "call-1", text: "mine" } },
			{ type: "custom", customType: ENTRY_TYPE, data: { nonsense: true } },
		];
		assert.deepEqual([...read({ getBranch: () => entries })], [["call-1", "mine"]]);
	});

	it("takes the last sentence written for a block", () => {
		const entries = [
			{ type: "custom", customType: ENTRY_TYPE, data: { id: "call-1", text: "first" } },
			{ type: "custom", customType: ENTRY_TYPE, data: { id: "call-1", text: "second" } },
		];
		assert.equal(read({ getBranch: () => entries }).get("call-1"), "second");
	});

	it("says nothing without a session, or without an id", () => {
		useSession(undefined, undefined);
		assert.equal(recall("call-1"), undefined);
		assert.equal(recall(undefined), undefined);
		assert.doesNotThrow(() => remember(undefined, "a note"));
	});
});

describe("pi's side of the bargain", () => {
	it("does not put a custom entry in the messages it sends", async () => {
		// The whole design rests on this. `appendEntry` writes an entry of type
		// "custom", and sessionEntryToContextMessages returns nothing for it --
		// so a sentence is stored in the session without the model reading it.
		// If pi ever starts including them, every summary joins the context.
		const { sessionEntryToContextMessages } = await import("@earendil-works/pi-coding-agent");
		const entry = {
			type: "custom",
			customType: ENTRY_TYPE,
			id: "e1",
			parentId: "e0",
			timestamp: new Date().toISOString(),
			data: { id: "call-1", text: "a note" },
		};
		assert.deepEqual(sessionEntryToContextMessages(entry as never), []);
	});
});
