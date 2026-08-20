/**
 * Folding a long command to one line.
 *
 * Run: pnpm test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { plain } from "../shared/ansi.ts";
import { fold, withoutRedundantCd } from "./index.ts";

const probe = {
	fg: (_token: string, text: string) => `\u001b[38;2;1;2;3m${text}\u001b[39m`,
	bold: (text: string) => text,
} as never;

describe("dropping a redundant cd", () => {
	const cwd = "/Users/someone/repos/project";

	it("drops it when it names the directory the command already runs in", () => {
		assert.equal(withoutRedundantCd(`cd ${cwd} && ls -la`, cwd), "ls -la");
	});

	it("keeps it when it names somewhere else, which changes what runs", () => {
		const command = "cd /tmp && ls -la";
		assert.equal(withoutRedundantCd(command, cwd), command);
	});

	it("understands the quoting a path with spaces needs", () => {
		const spaced = "/Users/someone/my project";
		assert.equal(withoutRedundantCd(`cd "${spaced}" && ls`, spaced), "ls");
		assert.equal(withoutRedundantCd(`cd '${spaced}' && ls`, spaced), "ls");
	});

	it("resolves a trailing slash and a relative segment to the same place", () => {
		assert.equal(withoutRedundantCd(`cd ${cwd}/ && ls`, cwd), "ls");
		assert.equal(withoutRedundantCd(`cd ${cwd}/sub/.. && ls`, cwd), "ls");
	});

	it("expands ~, which is how a command usually spells home", () => {
		const home = process.env.HOME!;
		assert.equal(withoutRedundantCd("cd ~ && ls", home), "ls");
	});

	it("leaves a cd that is not a prefix alone", () => {
		for (const command of [`ls && cd ${cwd}`, `cd ${cwd}; ls`, `cd ${cwd} || ls`, "cdx foo && ls"]) {
			assert.equal(withoutRedundantCd(command, cwd), command, command);
		}
	});
});

describe("folding", () => {
	it("leaves a command that already fits on one line", () => {
		const lines = ["ls -la"];
		assert.equal(fold(lines, "ls -la", 80, probe), lines);
	});

	it("returns one line, whatever it was given", () => {
		const lines = ["a", "b", "c", "d"];
		assert.equal(fold(lines, "a", 80, probe).length, 1);
	});

	it("says how many lines are hidden, not how many there are", () => {
		const folded = plain(fold(["a", "b", "c"], "a", 80, probe)[0]!);
		assert.match(folded, /\+2\b/, folded);
	});

	it("never runs past the width it is given", () => {
		const head = "cat > some/quite/long/path/to/a/file.swift <<'EOF'";
		for (let width = 10; width <= 60; width += 1) {
			const folded = fold(["x", "y", "z"], head, width, probe)[0]!;
			assert.ok(plain(folded).length <= width, `width ${width}: ${plain(folded)}`);
		}
	});

	it("gives up rather than mangle when the hint alone would not fit", () => {
		// Below the hint's own width there is no line that both says the command
		// and says how much is hidden, so the caller keeps what it had.
		const lines = ["a", "b"];
		assert.equal(fold(lines, "a", 1, probe), lines);
	});

	it("names the unit, so a number beside a command is not read as part of it", () => {
		const folded = plain(fold(["a", "b", "c"], "grep -rn x", 80, probe)[0]!);
		assert.match(folded, /\+2 lines$/, folded);
	});

	it("decides the wording in one place", () => {
		// Three functions pass the hint along; only one may write it.
		const source = readFileSync(join(import.meta.dirname, "index.ts"), "utf-8");
		const templates = [...source.matchAll(/`\s*\+\$\{hidden\}/g)];
		assert.equal(templates.length, 1, `${templates.length} places format the hint`);
	});

});
