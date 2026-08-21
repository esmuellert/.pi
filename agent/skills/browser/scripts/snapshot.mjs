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
 * Interactive nodes are numbered. Other scripts take that number rather than a
 * CSS selector, because a selector asks the reader to guess at markup it has
 * not seen, while a number names a line it has just read.
 *
 * Usage: node snapshot.mjs [--target <id>]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { attach, currentPage, ensure, outputDir } from "./cdp.mjs";

/** Node properties worth reporting: the ones that change what an element does. */
const STATES = new Set(["disabled", "checked", "expanded", "selected", "required", "invalid", "level", "focused"]);

/** Roles worth a number: the things a person clicks, types in, or chooses. */
const INTERACTIVE = new Set([
	"button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox",
	"listbox", "option", "menuitem", "menuitemcheckbox", "menuitemradio", "tab",
	"switch", "slider", "spinbutton", "textarea",
]);

const args = process.argv.slice(2);
const targetId = args.includes("--target") ? args[args.indexOf("--target") + 1] : undefined;

try {
	await ensure();
	const page = await currentPage(targetId);
	const { send, close } = await attach(page);
	await send("Accessibility.enable");
	const { nodes } = await send("Accessibility.getFullAXTree");
	close();

	const byId = new Map(nodes.map((node) => [node.nodeId, node]));
	const lines = [];
	const uids = [];
	let uid = 0;
	const seen = new Set();

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

	let folded = 0;

	const walk = (node, depth) => {
		if (!node || seen.has(node.nodeId)) return;
		seen.add(node.nodeId);

		if (isRedundant(node)) {
			folded += 1;
			// Its children, if any, still belong in the tree.
			for (const childId of node.childIds ?? []) walk(byId.get(childId), depth);
			return;
		}

		const role = node.role?.value ?? "";
		const name = clean(node.name?.value);
		const value = clean(node.value?.value);
		const handle = INTERACTIVE.has(role) && !node.ignored ? `[${++uid}] ` : "";
		if (handle) uids.push({ uid, nodeId: node.nodeId, backendDOMNodeId: node.backendDOMNodeId, role, name });

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

		for (const childId of node.childIds ?? []) walk(byId.get(childId), depth + 1);
	};

	const root = nodes.find((node) => !node.parentId) ?? nodes[0];
	walk(root, 0);
	// Anything the tree did not reach from the root, so nothing is lost.
	for (const node of nodes) walk(node, 0);

	const body = [
		`# ${page.title || "(untitled)"}`,
		`# ${page.url}`,
		`# ${nodes.length} nodes, ${uids.length} interactive, ${folded} folded as duplicate text`,
		`# [n] is a handle for click.mjs, fill.mjs and the rest`,
		"",
		...lines,
	].join("\n");

	const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	const file = join(outputDir(), `snapshot-${stamp}.txt`);
	writeFileSync(file, `${body}\n`, "utf-8");
	writeFileSync(join(outputDir(), "uids.json"), JSON.stringify({ targetId: page.id, uids }, null, "\t"), "utf-8");

	console.log(file);
	console.log(`${nodes.length} nodes, ${uids.length} interactive, ${lines.length} lines, ${(body.length / 1024).toFixed(0)}KB`);
	console.log(`${folded} nodes folded away; their text is in the line above them`);
	console.log("read it, or grep it for what you are after");
} catch (error) {
	console.error(String(error.message ?? error));
	process.exit(1);
}

function clean(value) {
	return value === undefined || value === null ? "" : String(value).replace(/\s+/g, " ").trim();
}
