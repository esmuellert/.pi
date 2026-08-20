# tool-blocks

Presentation for pi's tool blocks. pi's tools render their own blocks; this
takes those renderers over and applies features to what they produced.

```
 read ~/.pi/agent/extensions/cd/relocate.ts        mark: which tool, how it went
   export function relocateSession(

 $ ls -la | grep foo | wc -l                       bash: the layers pi's
   320                                             other six titles have
```

```bash
/tool-marks            # glyphs, letters, or off
```

## Layout

One folder per feature, and one folder for the mechanism they share.

| | |
|---|---|
| `tools/` | taking a tool over from pi without taking on its job |
| `shared/` | reading text that carries SGR, and the constants nothing can derive |
| `mark/` | a glyph per block: which tool ran, and how it went |
| `bash/` | the command line, layered the way pi's other titles are |
| `index.ts` | wires features to tools; the only place that calls `registerTool` |

**Only one extension can win this.** pi merges tool definitions with `Map.set`,
so if two extensions register `bash` the one loaded last silently replaces the
other. Every feature here goes through `tools/override.ts` and is composed in
`index.ts` for that reason: a feature that registered its own tool would
quietly disable its neighbours.

## tools — the takeover

pi resolves renderers field by field, preferring a registered tool's over the
built-in's:

```js
return this.toolDefinition.renderCall ?? this.builtInToolDefinition.renderCall;
```

so a tool re-registered as the built-in with one field replaced keeps pi's
`execute`, `parameters`, `description` and `renderShell`. Registering a tool
replaces the built-in outright, which is why nothing else may be touched —
`override.test.ts` checks that by identity.

Features do not see pi's renderer. They get two hooks:

```ts
retitle(lines, args, theme, context): string[] | undefined   // replace what pi drew
frame(inner, args, theme, context): Component                 // wrap it
```

Returning `undefined` from `retitle` leaves pi's rendering alone, which is what
every uncertain case does.

### The two things that would fail silently

`tool-execution.ts` catches renderer errors and falls back to a plain title, so
a broken override looks like a styling regression rather than a crash.

**pi hands a renderer the component it returned last time**, to update in place.
Handing the built-in a wrapper gives it something that is not the `Text` it
expects, and its `setText` throws. The inner component is kept in pi's per-row
state under a key of our own; `edit` keeps its diff preview in that same object.

**`invalidate()` is required by `Component`** and is called when the theme
changes. A wrapper that does not forward it leaves the block in the old theme.

## mark — one glyph per block

Where it sits marks the start of the header, its shape says which tool ran, and
its colour says running, worked or failed.

The glyph carries the outcome rather than the tool's name because the title
already opens with the name — `read ~/file`, `$ command`. What the title never
says is how the call went: a read of a missing file looks identical to one that
worked, and the block background carries that in a 15% tint where success and
error sit about 30 apart perceptually.

Whether the terminal's font has Nerd Font glyphs cannot be detected — a missing
one still measures a single column, so it renders as a box the layout is happy
with. `/tool-marks` asks once and remembers, in `~/.pi/agent/tool-blocks.json`.

## bash — the command line, in layers

Six of pi's seven tools set their title as a bold verb, an accent object and a
muted modifier. bash puts the whole command in one colour and bolds it end to
end:

```
read    ⟦bold⟧read⟦/bold⟧ ⟨accent⟩~/.pi/a.json ⟨muted⟩(limit 20)
bash    ⟦bold⟧$ ls -la | grep foo | wc -l⟦/bold⟧
```

That is why a long pipeline is hard to read, and why a four-line heredoc
arrives as four bold lines. This restores the layering, and bolds only the
prompt.

### Why not pi's own highlighter

pi highlights through highlight.js, whose bash grammar is written for script
files. Measured over 190 real commands from a working session:

| | coverage | recognises |
|---|---|---|
| highlight.js `bash` | 11% | quoted strings, a few builtins |
| TextMate `shell` | 98% | the command, its options, pipes, redirects, heredocs |

The parts highlight.js misses are exactly the parts a reader scans for. Asking
for `shell` or `console` instead gives 0%: those are for sessions with a prompt.

### Why shiki

`shiki` runs VS Code's tokeniser over the same TextMate grammars VS Code uses,
so the shell grammar is maintained by the people who maintain shell support in
an editor rather than by us. It also understands heredocs natively:

```
cat <<'PY'
x = 1; y = 2 | 3      ← one token, string.quoted.heredoc — not a pipe
PY
```

A hand-written tokeniser has to be told that. `shell-quote`, the obvious
library, cannot: it reads `<<'PY'` as two `<` operators and the body as shell.

Cost, with the fine-grained bundle — bash only, JavaScript regex engine, no
WebAssembly:

```
prepare()        15ms, once, at extension load
tokenize()       0.47ms per command
```

`renderCall` is synchronous, so preparation is awaited before anything is
registered. pi awaits the extension factory, which makes that possible.

Firing it off instead looked fine on a fresh start, where the first command is
seconds away, and failed on `/reload`: the module state resets, registration
wins the race, and the whole transcript redraws unhighlighted and then stands
still, because nothing draws it again. `startup.test.ts` holds the ordering.

### The adapter is a mapping, never a colour

`scopes.ts` maps TextMate scopes to pi theme *tokens*:

```ts
["entity.name.command",   "syntaxFunction"],
["constant.other.option", "syntaxNumber"],
["string.quoted.heredoc", "mdCodeBlock"],
```

so the active theme decides what any of it looks like, and a new theme needs no
change here. Scopes are hierarchical, so this matches on prefixes and the
longest wins: `string.quoted.heredoc` beats the `string` it also matches, and a
grammar that grows a new scope lands on its parent instead of falling out.

### What it costs to draw

Every tool block re-renders on every frame, so anything done per render is done
once per block per keystroke. Tokenising is half a millisecond, which is
nothing until a session holds eight hundred bash blocks and a still frame costs
two thirds of a second — typing goes visibly laggy, and it looks like the
session has grown too large.

Two caches, because the two costs have different keys:

| | keyed on | why |
|---|---|---|
| pieces | the command | tokenising depends on nothing else, so a resize must not redo it |
| lines | command, width and theme | wrapping and painting depend on all three |

```
a still frame       0.1ms      what a keystroke waits for
a resize          ~150ms      rewrapping, without re-tokenising
cold             ~270ms      once
```

`bash/cache.test.ts` holds both, and fails if either cache is removed.

### Nothing may alter the command

A highlighter that changes the text shows something other than what ran. Three
things guard that: the pieces must reassemble into the command, the painted
string must still read as the command after stripping SGR, and any doubt
returns `undefined` so pi's own rendering stands.

`bash/fixtures/commands.json` holds sixty commands from a real session — every
shape that appeared, including 1.7 kB heredocs — and every one is checked both
ways. Synthetic commands would not have found the two text-losing bugs this
caught while it was written.

## What is not hardcoded

Almost nothing is a number. The width comes from pi rather than being inferred
from what it drew, the gutter is the mark's own width plus its gap, the shiki
theme's name is read from the module that supplies it, and the scope table maps
to theme tokens so the theme decides every colour.

What is left is pinned. `shared/constants.test.ts` checks that every mark
measures the column it is given, that the letters stay distinct, that the scope
table holds prefixes rather than patterns and names no colour, and that
stripping SGR leaves OSC 8 hyperlinks — pi's clickable paths — intact.

## Tests

```bash
pnpm --filter pi-tool-blocks test
```

| file | what it holds |
|---|---|
| `tools/override.test.ts` | the assumptions about pi that make the takeover safe |
| `mark/frame.test.ts` | the framing: gutter, alignment, blank lines, forwarding |
| `bash/bash.test.ts` | the scope map, and the highlighter against real commands |
| `startup.test.ts` | the highlighter is ready before any tool is registered |
| `shared/constants.test.ts` | the few constants nothing derives, pinned to what they claim |
