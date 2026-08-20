# tool-icons

Marks each tool block with one glyph: where it sits marks the start of the
header, its shape says which tool ran, and its colour says how the call turned
out.

```
 read ~/.pi/agent/extensions/cd/contract.test.ts     ← success colour
   import assert from "node:assert/strict";

 $ node --experimental-strip-types build.ts          ← error colour
   Error: rose-pine has no role "highlightHigh"

 grep /toolSuccessBg/ in ~/.pi/agent (*.js)          ← muted, still running
```

```bash
/tool-icons            # glyphs, letters, or off
/tool-icons letters    # without the picker
```

Config lives in `~/.pi/agent/tool-icons.json`. Whether your font has Nerd Font
glyphs cannot be detected — a missing one still measures a single column, so it
renders as a box the layout is perfectly happy with — so it is asked once and
remembered, the same way the footer does it.

## Why a glyph and not a word

pi's titles already start with the tool's name:

```
read ~/file.ts        $ pnpm verify        grep /pattern/ in .
```

A chip with the word in it would say everything twice. The one thing the title
never says is how the call went: `read` looks identical whether the file was
there or not, and the block background carries the outcome in a 15% tint that
success and error share to within about 30 on a perceptual scale.

So the glyph does the job the title leaves open, and keeps saying which tool by
its shape rather than by repeating the word.

## What it does not change

The title text, its colours, its hyperlinks and the block background are all
pi's. This indents what pi's own renderer returned and writes a glyph into the
space that opens up.

pi resolves renderers field by field, preferring a registered tool's over the
built-in's:

```js
return this.toolDefinition.renderCall ?? this.builtInToolDefinition.renderCall;
```

so each tool is re-registered as pi's own definition with only `renderCall`
replaced. `execute`, `parameters`, `description` and `renderShell` are the ones
pi ships — `contract.test.ts` checks that by identity, since registering a tool
replaces the built-in outright and anything dropped would stop working rather
than fall back.

## The two things that would fail silently

`tool-execution.ts` catches renderer errors and falls back to a plain title, so
a broken wrapper looks like a styling regression rather than a crash. Both of
these are covered.

**pi hands a renderer the component it returned last time**, so it can update it
in place rather than allocating per frame. Handing the built-in the wrapper
instead gives it something that is not the `Text` it expects, and its `setText`
call throws. The inner component is kept in pi's per-row renderer state under a
key of our own; `edit` keeps its diff preview in that same object.

**`invalidate()` is required by `Component`** and is called when the theme
changes. A wrapper that does not forward it leaves the title painted in the
previous theme.

## Where the mark goes

On the first line that says something, not on line zero. `edit` sets
`renderShell: "self"` and draws its own frame, which opens with a blank padding
line — the mark belongs on its title, not floating above it. Blankness is judged
after stripping colour, since that padding line is painted.

A component with nothing to show keeps its shape rather than being given an
orphaned mark: `read` returns an empty result renderer when collapsed.

## Files

| | |
|---|---|
| `icons.ts` | glyph and letter per tool, colour per outcome |
| `wrap.ts` | the framing, as a `Component` around a `Component` |
| `config.ts` | `~/.pi/agent/tool-icons.json` |
| `index.ts` | re-registers pi's tools with the framing applied |

## Tests

```bash
pnpm --filter pi-tool-icons test
```

| file | what it holds |
|---|---|
| `wrap.test.ts` | the framing against a stub: gutter, alignment, blank lines, forwarding |
| `contract.test.ts` | the assumptions about pi that make it safe to apply to pi's own tools |

`contract.test.ts` asserts the `lastComponent` behaviour in both directions:
that pi's renderer reuses what it is handed, and that handing it a foreign
component throws. If the second stops being true, the state handoff is no longer
necessary and can go.
