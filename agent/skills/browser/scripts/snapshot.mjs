#!/usr/bin/env node
/**
 * The page's accessibility tree, written to a file.
 *
 * Nothing is summarised. The whole tree goes in, and the reader has `read`
 * with an offset and `grep` to reach the part it wants, rather than being
 * handed a selection somebody else made.
 *
 * Two kinds of node are folded away, each because its text is provably present
 * elsewhere -- checked at the time of writing against a GitHub repo page, and
 * checked again on every node as the tree is walked:
 *
 *   InlineTextBox   Chrome's per-line layout boxes. "Skip to content" becomes
 *                   fifteen of them, one per character. All 848 with text had
 *                   that text in their own parent's name.
 *
 *   StaticText      folded only when it is an only child whose text is exactly
 *                   its parent's name -- 240 of 708 on that page. The other
 *                   468 are kept: "© 2026 GitHub, Inc.", "2 weeks ago" and
 *                   paragraph bodies exist nowhere else, and an earlier version
 *                   that dropped all StaticText lost them.
 *
 * Anything failing its check is kept. Together they fold about a third of the
 * lines and no text at all.
 *
 * Every frame is walked, not just the main one. A page that puts its payment
 * fields, its editor or its sign-in in an iframe is otherwise empty here.
 *
 * Interactive nodes are numbered, and the number is written onto the element
 * as an attribute so the other scripts can find it again. A number names a
 * line the reader has just seen; a CSS selector asks it to guess at markup it
 * has not.
 *
 * Usage: node snapshot.mjs [--tab <n>]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { UID_ATTRIBUTE } from "./act.mjs";
import { connect, explain, outputDir, stamp } from "./browser.mjs";

/** Node properties worth reporting: the ones that change what an element does. */
const STATES = new Set(["disabled", "checked", "expanded", "selected", "required", "invalid", "level", "focused"]);

/** Roles worth a number: the things a person clicks, types in, or chooses. */
const INTERACTIVE = new Set([
	"button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox",
	"listbox", "option", "menuitem", "menuitemcheckbox", "menuitemradio", "tab",
	"switch", "slider", "spinbutton", "textarea",
]);

const args = process.argv.slice(2);
const tabAt = args.indexOf("--tab");
const tab = tabAt >= 0 ? args[tabAt + 1] : undefined;

let session;
try {
	session = await connect({ tab });
	const cdp = await session.context.newCDPSession(session.page);
	// The tab's own id, so a handle still names this tab after another is closed.
	const pageId = (await cdp.send("Target.getTargetInfo")).targetInfo.targetId;
	await cdp.send("Accessibility.enable");
	const { frameTree } = await cdp.send("Page.getFrameTree");

	const lines = [];
	const uids = [];
	const tagging = [];
	let uid = 0;
	let folded = 0;
	const skipped = [];

	/** Every frame in the tree, outermost first, so the file reads top-down. */
	const frames = [];
	(function collect(node) {
		frames.push({ id: node.frame.id, url: node.frame.url, depth: frames.length === 0 ? 0 : 1 });
		for (const child of node.childFrames ?? []) collect(child);
	})(frameTree);

	for (const frame of frames) {
		let nodes;
		try {
			({ nodes } = await cdp.send("Accessibility.getFullAXTree", { frameId: frame.id }));
		} catch (error) {
			// A cross-origin frame is a target of its own and is not readable from
			// here. Saying so is better than an empty region the reader cannot
			// account for.
			skipped.push(`${frame.url} (${error.message})`);
			continue;
		}
		if (frames.length > 1) {
			lines.push("", `--- frame: ${frame.url} ---`);
		}
		const outcome = walk(nodes);
		folded += outcome.folded;
	}

	/** Walk one frame's tree, appending to the shared lines and handles. */
	function walk(nodes) {
		const byId = new Map(nodes.map((node) => [node.nodeId, node]));
		const seen = new Set();
		let foldedHere = 0;

		/** True when this node's text is certainly written somewhere else already. */
		const isRedundant = (node) => {
			const role = node.role?.value;
			const text = clean(node.name?.value);
			if (!text) return false;
			const parent = byId.get(node.parentId);
			if (!parent) return false;
			if (role === "InlineTextBox") return clean(parent.name?.value).includes(text);
			if (role === "StaticText") {
				return (parent.childIds ?? []).length === 1 && clean(parent.name?.value) === text;
			}
			return false;
		};

		const visit = (node, depth) => {
			if (!node || seen.has(node.nodeId)) return;
			seen.add(node.nodeId);

			if (isRedundant(node)) {
				foldedHere += 1;
				// Its children, if any, still belong in the tree.
				for (const childId of node.childIds ?? []) visit(byId.get(childId), depth);
				return;
			}

			const role = node.role?.value ?? "";
			const name = clean(node.name?.value);
			const value = clean(node.value?.value);
			let handle = "";
			if (INTERACTIVE.has(role) && !node.ignored && node.backendDOMNodeId !== undefined) {
				uid += 1;
				handle = `[${uid}] `;
				uids.push({ uid, role, name, tab: pageId });
				tagging.push({ uid, backendDOMNodeId: node.backendDOMNodeId });
			}

			const states = (node.properties ?? [])
				.filter((property) => STATES.has(property.name) && property.value?.value !== undefined && property.value.value !== "")
				.map((property) => `${property.name}=${property.value.value}`);

			lines.push([
				"  ".repeat(Math.min(depth, 20)) + handle + (role || "?"),
				name ? `"${name}"` : "",
				value && value !== name ? `= ${value}` : "",
				node.ignored ? "(ignored)" : "",
				states.length ? `(${states.join(" ")})` : "",
			].filter(Boolean).join(" "));

			for (const childId of node.childIds ?? []) visit(byId.get(childId), depth + 1);
		};

		const root = nodes.find((node) => !node.parentId) ?? nodes[0];
		visit(root, 0);
		// Anything the tree did not reach from the root, so nothing is lost.
		for (const node of nodes) visit(node, 0);
		return { folded: foldedHere };
	}

	// Mark the elements, so a handle can be found again by a later process.
	let tagged = 0;
	for (const entry of tagging) {
		try {
			const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: entry.backendDOMNodeId });
			await cdp.send("Runtime.callFunctionOn", {
				objectId: object.objectId,
				functionDeclaration: `function (uid) { this.setAttribute(${JSON.stringify(UID_ATTRIBUTE)}, String(uid)); }`,
				arguments: [{ value: entry.uid }],
			});
			tagged += 1;
		} catch {
			// The element went away between reading the tree and marking it. The
			// handle stays in the file; using it will say it is gone.
		}
	}
	await cdp.detach();

	const header = [
		`# ${await session.page.title().catch(() => "(untitled)")}`,
		`# ${session.page.url()}`,
		`# ${uids.length} interactive, ${folded} folded as duplicate text, ${frames.length} frame(s)`,
		`# [n] is a handle for click.mjs, fill.mjs and the rest`,
		...(tagged === tagging.length ? [] : [`# ${tagging.length - tagged} handle(s) vanished while being marked`]),
		...skipped.map((frame) => `# not readable: ${frame}`),
	];
	const body = [...header, "", ...lines].join("\n");

	const file = join(outputDir(), `snapshot-${stamp()}.txt`);
	writeFileSync(file, `${body}\n`, "utf-8");
	writeFileSync(join(outputDir(), "uids.json"), JSON.stringify({ url: session.page.url(), uids }, null, "\t"), "utf-8");

	console.log(file);
	console.log(`${uids.length} interactive, ${lines.length} lines, ${(body.length / 1024).toFixed(0)}KB, ${frames.length} frame(s)`);
	if (skipped.length) console.log(`${skipped.length} frame(s) not readable — see the header`);
	console.log("read it, or grep it for what you are after");
} catch (error) {
	console.error(explain(error));
	process.exitCode = 1;
} finally {
	await session?.done();
}

function clean(value) {
	return value === undefined || value === null ? "" : String(value).replace(/\s+/g, " ").trim();
}
