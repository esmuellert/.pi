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

import { prepare, ready, tokenize, whyUntokenised } from "./engine.ts";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

import { paint, retitling, title } from "./title.ts";
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
			// Report why, not just that: the fallback path is silent by design,
			// which once turned one intermittent failure into five opaque ones.
			assert.ok(pieces, () => {
				const why = whyUntokenised();
				return `no pieces for ${JSON.stringify(command.slice(0, 80))}: ${why?.error instanceof Error ? `${why.error.name}: ${why.error.message}` : String(why?.error)}`;
			});
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
});

describe("pi-tui's wrapping", () => {
	it("breaks styled text differently from the same text unstyled", () => {
		// The reason retitling has to drop blank lines. If this ever fails,
		// pi-tui has been fixed and unpad() can go.
		//
		// The bug needs a styled word to land exactly on the boundary, so it
		// shows at some widths and not others. Searching rather than naming one
		// width keeps the test about the bug instead of about a coincidence.
		const text = "$ cd /home/dev/repos/atlas && sed -n '1,120p' atlas.xcodeproj/project.pbxproj";
		const styled = text.split(" ").map((word) => (word ? `\u001b[38;2;1;2;3m${word}\u001b[39m` : word)).join(" ");
		const differs = (width: number) => {
			const bare = wrapTextWithAnsi(text, width);
			const coloured = wrapTextWithAnsi(styled, width).map(plain);
			return JSON.stringify(coloured) !== JSON.stringify(bare) && coloured.includes("");
		};
		const widths = Array.from({ length: 60 }, (_, i) => i + 12).filter(differs);
		assert.ok(widths.length > 0, "pi-tui now wraps styled and unstyled text alike at every width");
	});
});

describe("retitling at a width", () => {
	before(async () => {
		await prepare();
	});

	const retitle = retitling();
	/** What pi would have handed over: the command, wrapped to `width`. */
	const asPiWould = (command: string, width: number) =>
		command.split("\n").flatMap((line) => wrapTextWithAnsi(`$ ${line}`, width));

	it("highlights at every width, not only where the command fits", () => {
		// The first version compared line counts and gave up when they differed,
		// so highlighting vanished the moment a pane was too narrow for the
		// command — on a phone always, and on a desktop as soon as it narrowed.
		for (const command of COMMANDS.slice(0, 12)) {
			for (const width of [120, 80, 60, 40, 30, 24, 16]) {
				const lines = asPiWould(command, width);
				const out = retitle(() => lines, width, { command } as never, probe, { state: {}, expanded: true, cwd: process.cwd() } as never);
				assert.ok(out, `no title at width ${width} for ${JSON.stringify(command.slice(0, 40))}`);
			}
		}
	});

	it("breaks where pi would have broken it", () => {
		for (const command of COMMANDS.slice(0, 12)) {
			for (const width of [80, 40, 24]) {
				const lines = asPiWould(command, width);
				const out = retitle(() => lines, width, { command } as never, probe, { state: {}, expanded: true, cwd: process.cwd() } as never)!;
				assert.deepEqual(out.map(plain), lines.map(plain), `width ${width}`);
			}
		}
	});

	it("uses the width it is given, not one guessed from pi's lines", () => {
		// Word wrapping leaves lines short of the width — by five columns in
		// these fixtures — so inferring it from the longest line pi produced
		// wraps tighter than pi did.
		const command = "a bb ccc dddd eeeee ffffff";
		const lines = asPiWould(command, 25);
		const inferred = Math.max(...lines.map((line) => plain(line).length));
		assert.notEqual(inferred, 25, "this fixture must be one where inference would be wrong");
		assert.deepEqual(
			retitle(() => lines, 25, { command } as never, probe, { state: {}, expanded: true, cwd: process.cwd() } as never)!.map(plain),
			lines.map(plain),
		);
	});

	it("never overflows the width it was given", () => {
		for (const command of COMMANDS.slice(0, 12)) {
			for (const width of [60, 30, 20]) {
				for (const line of retitle(() => asPiWould(command, width), width, { command } as never, probe, { state: {}, expanded: true, cwd: process.cwd() } as never)!) {
					assert.ok(plain(line).length <= width, `${plain(line).length} > ${width}`);
				}
			}
		}
	});

	it("leaves untokenised runs unpainted rather than dropping them", () => {
		const pieces = [{ text: "a", token: undefined }, { text: "b", token: "syntaxFunction" }];
		const painted = paint(pieces, probe);
		assert.equal(plain(painted), "ab");
		assert.ok(!painted.startsWith("\u001b"), "the untokenised run should not be painted");
	});
});
