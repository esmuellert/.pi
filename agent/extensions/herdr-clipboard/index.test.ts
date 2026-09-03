import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadRuntimeClipboard } from "./index.ts";

test("resolves clipboard from the running pi entrypoint rather than the extension", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-herdr-clipboard-"));
	try {
		const entrypoint = join(root, "dist", "cli.js");
		const packageDir = join(root, "node_modules", "@mariozechner", "clipboard");
		mkdirSync(join(root, "dist"), { recursive: true });
		mkdirSync(packageDir, { recursive: true });
		writeFileSync(entrypoint, "");
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({ name: "@mariozechner/clipboard", version: "0.0.0", main: "index.cjs" }),
		);
		writeFileSync(join(packageDir, "index.cjs"), "module.exports = { setText() {} };\n");

		const clipboard = loadRuntimeClipboard(entrypoint);

		assert.equal(typeof clipboard?.setText, "function");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
