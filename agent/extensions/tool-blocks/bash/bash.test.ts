/**
 * The bash feature, against real commands.
 *
 * The fixture is sixty commands taken from a working session, chosen to cover
 * every shape that appeared: pipelines, heredocs, command substitution,
 * redirects, multi-line loops. Synthetic commands would not have found the two
 * bugs this caught while it was being written.
 *
 * Run: pnpm test
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, describe, it } from "node:test";

import { prepare, ready, tokenize } from "./engine.ts";
import { paint, title } from "./title.ts";
import { tokenForScope, tokenForStack, SCOPE_TOKENS } from "./scopes.ts";

const COMMANDS: string[] = JSON.parse(
	readFileSync(join(import.meta.dirname, "fixtures/commands.json"), "utf-8"),
);

/**
 * A theme that emits real SGR sequences.
 *
 * title() checks its own output by stripping SGR and comparing with the
 * command, so a probe that emits anything else would fail that check and hide
 * what is being tested. Which token a run was given is asked of tokenize()
 * instead, which returns them directly.
 */
const probe = {
	fg: (_token: string, text: string) => `\u001b[38;2;1;2;3m${text}\u001b[39m`,
	bold: (text: string) => `\u001b[1m${text}\u001b[22m`,
} as never;

const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "");

describe("scopes", () => {
	it("maps a scope to a pi token by its longest matching prefix", () => {
		assert.equal(tokenForScope("entity.name.command.shell"), "syntaxFunction");
		assert.equal(tokenForScope("constant.other.option.dash.shell"), "syntaxNumber");
		assert.equal(tokenForScope("keyword.operator.pipe.shell"), "syntaxOperator");
	});

	it("lets a longer prefix win over a shorter one", () => {
		// Both `string` and `string.quoted.heredoc` match a heredoc body.
		assert.equal(tokenForScope("string.quoted.heredoc.no-indent.PY"), "mdCodeBlock");
		assert.equal(tokenForScope("string.quoted.double.shell"), "syntaxString");
	});

	it("claims nothing it does not recognise", () => {
		assert.equal(tokenForScope("source.shell"), undefined);
		assert.equal(tokenForScope("something.invented"), undefined);
	});

	it("reads a scope stack innermost first", () => {
		// A string inside a heredoc carries both; the inner one decides.
		assert.equal(tokenForStack(["source.shell", "string.quoted.heredoc.PY"]), "mdCodeBlock");
		assert.equal(tokenForStack(["source.shell"]), undefined);
	});

	it("names only tokens, never colours", () => {
		for (const [, token] of SCOPE_TOKENS) {
			assert.doesNotMatch(token, /^#|\u001b/, `${token} looks like a colour, not a theme token`);
		}
	});
});

describe("the highlighter", () => {
	before(async () => {
		assert.ok(await prepare(), "shiki failed to load");
	});

	it("becomes ready", () => {
		assert.ok(ready());
	});

	it("never alters a command", () => {
		// A highlighter that changes the text shows something other than what ran.
		for (const command of COMMANDS) {
			const pieces = tokenize(command);
			assert.ok(pieces, "no pieces");
			assert.equal(pieces.map((piece) => piece.text).join(""), command, JSON.stringify(command.slice(0, 60)));
		}
	});

	it("recognises the parts a reader scans for", () => {
		const pieces = tokenize("ls -la | grep foo && echo \"done\"")!;
		const by = (text: string) => pieces.find((piece) => piece.text === text)?.token;
		assert.equal(by("ls"), "syntaxFunction", "the command");
		assert.equal(by("-la"), "syntaxNumber", "an option");
		assert.equal(by("|"), "syntaxOperator", "a pipe");
		assert.equal(by("&&"), "syntaxOperator", "a list operator");
		assert.equal(by("echo"), "syntaxKeyword", "a builtin");
		assert.equal(by("done"), "syntaxString", "a quoted string");
	});

	it("treats a heredoc body as text rather than shell", () => {
		// Inside a heredoc a `;` is not an operator, which is the thing a
		// hand-written tokeniser has to be told and this grammar already knows.
		const pieces = tokenize("cat <<'PY'\nx = 1; y = 2 | 3\nPY")!;
		const body = pieces.find((piece) => piece.text.includes("y = 2"));
		assert.ok(body, "the body did not survive as one piece");
		assert.equal(body.token, "mdCodeBlock");
	});

	it("finds a command again after a pipe", () => {
		const pieces = tokenize("a | b | c")!;
		const commands = pieces.filter((piece) => piece.token === "syntaxFunction").map((piece) => piece.text);
		assert.deepEqual(commands, ["a", "b", "c"]);
	});
});

describe("title", () => {
	before(async () => {
		await prepare();
	});

	it("reads back as the command it was given", () => {
		for (const command of COMMANDS) {
			const styled = title(command, probe);
			assert.ok(styled, JSON.stringify(command.slice(0, 50)));
			assert.equal(plain(styled), `$ ${command}`);
		}
	});

	it("bolds only the prompt, so a multi-line command is not bold throughout", () => {
		// pi bolds the whole command, so a four-line heredoc arrives as four
		// bold lines. This is the thing that fix is for.
		const bolded: string[] = [];
		const counting = { fg: (_t: string, s: string) => s, bold: (s: string) => (bolded.push(s), s) } as never;
		title("cat <<'PY'\nimport json\nPY", counting);
		assert.deepEqual(bolded, ["$"]);
	});

	it("declines rather than guess", () => {
		assert.equal(title("", probe), undefined);
	});

	it("leaves untokenised runs unpainted rather than dropping them", () => {
		const pieces = [{ text: "a", token: undefined }, { text: "b", token: "syntaxFunction" }];
		const painted = paint(pieces, probe);
		assert.equal(plain(painted), "ab");
		assert.ok(!painted.startsWith("\u001b"), "the untokenised run should not be painted");
	});
});
