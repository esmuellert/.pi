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
import { fold, KEPT_LINES, withoutRedundantCd } from "./index.ts";

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

	it("keeps the opening lines and no more", () => {
		// The first ones, not the last: a command's opening says what it is doing,
		// while its end is a heredoc terminator.
		const lines = Array.from({ length: 20 }, (_, at) => `line${at}`);
		const folded = fold(lines, "line0", 80, probe);
		assert.equal(folded.length, KEPT_LINES);
		assert.match(plain(folded[0]!), /^line0/);
		assert.match(plain(folded[1]!), /^line1/);
	});

	it("leaves a command that already fits alone", () => {
		const short = Array.from({ length: KEPT_LINES }, (_, at) => `line${at}`);
		assert.deepEqual(fold(short, "line0", 80, probe), short);
	});

	it("says how many lines are hidden, not how many there are", () => {
		const lines = Array.from({ length: KEPT_LINES + 2 }, (_, at) => `line${at}`);
		const folded = plain(fold(lines, "line0", 80, probe).at(-1)!);
		assert.match(folded, /\+2\b/, folded);
	});

	it("never runs past the width it is given", () => {
		const head = "cat > some/quite/long/path/to/a/file.swift <<'EOF'";
		const lines = Array.from({ length: KEPT_LINES + 3 }, () => "x".repeat(70));
		for (let width = 10; width <= 60; width += 1) {
			const folded = fold(lines, head, width, probe).at(-1)!;
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
		const lines = Array.from({ length: KEPT_LINES + 2 }, (_, at) => `line${at}`);
		const folded = plain(fold(lines, "grep -rn x", 80, probe).at(-1)!);
		assert.match(folded, /\+2 lines$/, folded);
	});

	it("decides the wording in one place", () => {
		// Three functions pass the hint along; only one may write it.
		const source = readFileSync(join(import.meta.dirname, "index.ts"), "utf-8");
		const templates = [...source.matchAll(/`\s*\+\$\{hidden\}/g)];
		assert.equal(templates.length, 1, `${templates.length} places format the hint`);
	});

});

describe("what a fold leaves behind", () => {
	it("never closes with a full reset", () => {
		// pi-tui's truncateToWidth closes what it cut with `\u001b[0m`, which
		// clears the background as well as the colour. A block's background is
		// painted once at the start of the line, so everything after that reset
		// -- the ellipsis, and the hint after it -- drew on the terminal's own
		// background as a dark band to the right edge.
		const long = "x".repeat(200);
		const lines = [long, ...Array.from({ length: KEPT_LINES + 2 }, () => long)];
		for (const width of [20, 34, 56, 80]) {
			for (const line of fold(lines, long, width, probe)) {
				assert.ok(!line.includes("\u001b[0m"), `width ${width} left a full reset`);
			}
		}
	});
});
