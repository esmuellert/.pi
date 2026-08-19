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
| 2 | **Context bar** | Grows within a small absolute range (6–14 cells). A bar carries about one digit of information, so letting it scale with width makes it swallow whole lines. |
| 3 | **Balanced wrap** | Lines are re-wrapped to even out their lengths, so the block never strands a lone segment on the last line. |
| 4 | **Omission** | Past `maxLines`, the lowest-priority segments are dropped entirely. Better to omit a field than to make it cryptic. |

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

**Display order is by stability; priority is by importance.** They are separate.

Left-aligned text means a field that changes width pushes everything to its
right. So the fields that rarely change lead, and the per-turn counters trail:

`cwd (branch)` → `model · think` → `ctx` → `in` → `out` → `cache` → `hit` → `cost`

A pleasant side effect is that the wrap tends to fall between the stable fields
and the counters on its own, without any hardcoded grouping.

Order is otherwise fixed: greedy flow is already line-count optimal for a fixed
order, and reordering to reclaim a few cells (a bin-packing problem) would make
fields jump between positions on every resize.

Priority decides **only what gets dropped**, never what gets shortened,
reordered, or displayed first. `ctx` is displayed third but is the last field
to be omitted.

Default priority: `ctx(10) > model(9) > cost(8) > hit(7) > in/out(6) > cache(5) > cwd(4) > session(3) > queue(2) > provider(1)`

## Fields

| Field | Meaning |
|---|---|
| `model · think` | Current model and reasoning level |
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
layout.test.ts  312 assertions
```

`index.ts` is the only file that touches pi APIs; everything else is pure and
directly testable.

## Tests

```bash
npm test
```

Sweeps every width from 4 to 400 across 18 session states and 12 configs,
asserting:

- lines never exceed the terminal width or the line budget
- kept + dropped always partitions the full segment set, with no duplicates
- omission strictly follows priority
- wording is byte-identical at 20 and 200 columns
- lines are left aligned by default, and still spread when `maxGap` is raised
- line count and drop count are monotone in width, changing by at most one per column
- the context bar stays inside its configured range and never scales with width
- wrapping stays balanced (line-length evenness: min 33%, mean 72%)
- display order is by stability, and stays independent of omission priority
- optional fields appear only when unhidden, and vanish when their value is empty
- garbage configs (`null`, arrays, wrong types, out-of-range numbers) fall back cleanly

## Config

`~/.pi/agent/footer.json`, all keys optional:

```json
{
  "maxLines": 6,
  "hide": ["cwd"],
  "priority": { "cache": 9 },
  "ctxWarn": 65,
  "ctxDanger": 85,
  "separator": "  ",
  "maxGap": 0,
  "minBar": 6,
  "maxBar": 14
}
```

`maxGap` is the justification cap; `0` (the default) means plain left alignment.

A malformed config degrades to defaults rather than taking the TUI down.

## Commands

- `/footer` — toggle between this footer and the built-in one
- `/reload` — re-read `footer.json` and reinstall

## Adding a field

Add one entry to the array in `segments.ts` and give it a priority in
`DEFAULT_PRIORITY`. The layout engine picks it up with no other changes.
