/**
 * Turning a snapshot handle back into something on the page.
 *
 * Shared by click, fill, hover and the rest. The handle is a number the
 * snapshot printed; uids.json remembers what it pointed at.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { attach, currentPage, ensure, outputDir } from "./cdp.mjs";

/** What the last snapshot numbered, or a reason there is nothing. */
export function handles() {
	try {
		return JSON.parse(readFileSync(join(outputDir(), "uids.json"), "utf-8"));
	} catch {
		throw new Error("no snapshot yet — run snapshot.mjs first");
	}
}

/** Look up one handle, with a message that says what to do when it is gone. */
export function resolve(uid) {
	const { targetId, uids } = handles();
	const found = uids.find((entry) => entry.uid === Number(uid));
	if (!found) {
		throw new Error(`no [${uid}] in the last snapshot — it has ${uids.length} handles; take another snapshot if the page has changed`);
	}
	return { targetId, ...found };
}

/**
 * Open the page a handle belongs to and hand back a way to talk to it.
 *
 * The DOM node id is resolved fresh each time: a snapshot names a node, and
 * the page may have replaced it since. Failing here is better than clicking
 * whatever now sits at those coordinates.
 */
export async function withElement(uid, work) {
	const target = resolve(uid);
	await ensure();
	const page = await currentPage(target.targetId);
	const { send, close } = await attach(page);
	try {
		await send("DOM.enable");
		await send("DOM.getDocument", { depth: -1 });
		const { object } = await send("DOM.resolveNode", { backendNodeId: target.backendDOMNodeId });
		if (!object?.objectId) throw new Error(`[${uid}] is no longer on the page — take another snapshot`);
		return await work({ send, objectId: object.objectId, target, page });
	} finally {
		close();
	}
}

/** Run an expression against an element, as a function taking it. */
export async function callOn(send, objectId, functionDeclaration, args = []) {
	const { result, exceptionDetails } = await send("Runtime.callFunctionOn", {
		objectId,
		functionDeclaration,
		arguments: args.map((value) => ({ value })),
		returnByValue: true,
		awaitPromise: true,
	});
	if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
	return result?.value;
}
