# Responsive Footer

Width-adaptive multi-line footer for the pi coding agent.

## Design rule

**Never trade readability for width.** Labels are always spelled out —
`cache 29.5M/1.5M`, never `c29M` — at every terminal size. A narrow terminal is
short on columns but rich on rows, so the layout degrades by wrapping, not by
abbreviating.

## Elasticity, in order

| Step | Mechanism | Why |
|---|---|---|
| 1 | **Wrapping** | Segments flow like words in a paragraph. Rows are cheap on a phone. |
| 2 | **Context bar** | Sized within a small absolute range (6–14 cells), then grown into otherwise unused width. A candidate is rejected if it adds a line, and narrow terminals cap the bar at 40% of their width (or the configured minimum), so fill never makes the footer taller or lets the graphic dominate a line. |
| 3 | **Balanced wrap** | Lines are re-wrapped to even out their lengths, so the block never strands a lone segment on the last line. |

**Nothing is ever dropped.** Every visible field renders at every width. The
line count is self-limiting — worst case is one segment per line, which needs a
terminal too narrow to use. At 40 columns the default set takes 4 lines; at 78
it takes 2.

There are no hardcoded width tiers. Because wording is fixed, resizing only
changes wrapping, so the layout moves in single-line steps.

## Alignment

**Left aligned, always.** Justified spacing was tried and removed: gaps are
recomputed from the current values, so `in 470` growing to `in 1.2k` shifts
every field on the line. Uniform two-space separators keep positions stable and
let the footer read as a list rather than scattered fragments.

Trailing space is therefore expected — measured fill over widths 20–200 is
mean 79%. Fill is not the goal; scannability is. Set `maxGap > 0` to opt back
into spreading.

## Ordering

**Display order is by stability.**

Left-aligned text means a field that changes width pushes everything to its
right. So the fields that rarely change lead, and the per-turn counters trail:

`cwd (branch)` → `model · think` → `ctx` → `in` → `out` → `cache` → `hit` → `cost`

A pleasant side effect is that the wrap tends to fall between the stable fields
and the counters on its own, without any hardcoded grouping.

Order is otherwise fixed: greedy flow is already line-count optimal for a fixed
order, and reordering to reclaim a few cells (a bin-packing problem) would make
fields jump between positions on every resize.


## Icons

Folder, git branch and cache use Nerd Font glyphs. Everything else keeps its
written label: there is no shared visual vocabulary for "input tokens", so an
icon there would be guesswork rather than shorthand.

**Nerd Font support cannot be detected.** The font is a terminal UI setting the
process cannot read, and a missing glyph renders as a box that still measures
one cell — so a cursor-position probe cannot tell a missing glyph from a present
one. Starship ships a separate `plain-text-symbols` preset for this reason, and
Oh My Posh documents the same limitation.

So the answer is a line in the config rather than a probe: set `"icons": false`
in `footer.json` if the glyphs come out as boxes.

## Fields

| Field | Meaning |
|---|---|
| `model · level` | Current model and reasoning level |
| `ctx ▓▓░░ 40% 403.4k/1.0M` | Context usage; bar turns yellow at `ctxWarn`, red at `ctxDanger` |
| `in` / `out` | Cumulative input / output tokens |
| `cache r/w` | Cumulative cache reads / writes |
| `hit` | Latest cache hit rate (cache reads cost ~10% of fresh input, so this is money) |
| `$` | Cumulative cost, `sub` when a subscription covers it |
| `cwd (branch)` | Working directory and git branch (`detached` on a detached HEAD) |
| `session` | Session name, when set — hidden by default |
| `via provider` | Model provider — hidden by default |
| `queued` | Messages waiting to be delivered — hidden by default |

Hidden fields are listed in `hide`. A user config replaces that array wholesale,
so `"hide": []` shows everything.

## Layout

```
index.ts        Extension wiring: reads session state, paints the result
layout.ts       Pure layout engine: flow, balance, plan
segments.ts     Session snapshot -> ordered segment list
config.ts       footer.json loading and validation
format.ts       Counts, progress bar, display width, path shortening
layout.test.ts  260 assertions
```

`index.ts` is the only file that touches pi APIs; everything else is pure and
directly testable.

## Tests

```bash
npm test
```

Sweeps every width from 4 to 400 across 18 session states and 12 configs,
asserting:

- lines never exceed the terminal width
- no field is ever dropped, at any width
- every visible field renders exactly once, with no duplicates
- wording is byte-identical at 20 and 200 columns
- lines are left aligned by default, and still spread when `maxGap` is raised
- line count and drop count are monotone in width, changing by at most one per column
- the context bar stays inside its configured range and narrow-width share, fills the terminal as well as any valid candidate, and never adds a line
- wrapping stays balanced (line-length evenness: min 33%, mean 72%)
- display order is by stability
- optional fields appear only when unhidden, and vanish when their value is empty
- garbage configs (`null`, arrays, wrong types, out-of-range numbers) fall back cleanly

## Config

`~/.pi/agent/footer.json`, all keys optional:

```json
{
  "hide": ["cwd"],
  "ctxWarn": 65,
  "ctxDanger": 85,
  "separator": "  ",
  "maxGap": 0,
  "minBar": 6,
  "maxBar": 14,
  "icons": true
}
```

`maxGap` is the justification cap; `0` (the default) means plain left alignment.

A malformed config degrades to defaults rather than taking the TUI down.


- `/reload` — re-read `footer.json` and reinstall

## Adding a field

Add one entry to the array in `segments.ts`, placed by how often its value
changes. The layout engine picks it up with no other changes. Add its id to
`DEFAULT_HIDDEN` if it should be opt-in.
