/**
 * Turning a snapshot handle back into something Playwright can act on.
 *
 * The snapshot puts an attribute on every element it numbers, and a handle is
 * a lookup for that attribute. The alternative -- rebuilding a locator from
 * the role and name the snapshot printed -- asks two accessible-name
 * implementations to agree, Chrome's and Playwright's, and one real page here
 * has a button named "\uf090 Login" where the first character is a Font
 * Awesome glyph. The attribute is exact and it is ours.
 *
 * What it costs: the page is modified. A page that watches its own DOM can
 * see the attribute appear. None encountered so far do, and the alternative
 * costs correctness.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { connect, outputDir } from "./browser.mjs";

/** The attribute the snapshot writes and the locators look for. */
export const UID_ATTRIBUTE = "data-pi-uid";

/** What the last snapshot numbered, or a reason there is nothing. */
export function handles() {
	try {
		return JSON.parse(readFileSync(join(outputDir(), "uids.json"), "utf-8"));
	} catch {
		throw new Error("no snapshot yet — run snapshot.mjs first");
	}
}

/** Look up one handle, with a message that says what to do when it is gone. */
export function lookup(uid) {
	const { uids, ...rest } = handles();
	const found = uids.find((entry) => entry.uid === Number(uid));
	if (!found) {
		throw new Error(
			`no [${uid}] in the last snapshot — it numbered ${uids.length} elements; take another snapshot if the page has changed`,
		);
	}
	return { ...rest, ...found };
}

/**
 * Open the page a handle belongs to and hand back a locator for it.
 *
 * Every frame is searched rather than the one the snapshot came from. Frame
 * identity does not survive between processes: `Page.getFrameTree` reports an
 * iframe with no src under its parent's url, so two frames on one page can
 * carry the same address and matching on it picks the wrong one. The attribute
 * is unique across the page, so asking each frame whether it has that element
 * needs no identity at all.
 *
 * Everything Playwright does to a locator -- waiting for it to be visible,
 * stable, enabled and actually hit by a click at that point, and retrying
 * until it is -- happens because this returns a locator rather than
 * coordinates.
 */
export async function withHandle(uid, work) {
	const target = lookup(uid);
	const session = await connect({ pageIndex: target.pageIndex });
	try {
		const selector = `[${UID_ATTRIBUTE}="${target.uid}"]`;
		let locator;
		for (const frame of session.page.frames()) {
			const candidate = frame.locator(selector);
			if (await candidate.count().catch(() => 0) > 0) {
				locator = candidate;
				break;
			}
		}
		if (!locator) {
			throw new Error(`[${uid}] is no longer on the page — take another snapshot`);
		}
		return await work({ locator, target, ...session });
	} finally {
		await session.done();
	}
}

/** How a handle should be named back to the reader. */
export function describe(uid, target) {
	return `[${uid}] ${target.role} ${JSON.stringify(target.name)}`;
}
