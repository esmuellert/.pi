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
| 3 | **Justification** | Leftover slack is shared between gaps. Capped on busy lines, unrestricted when a line has ≤2 gaps (spreading two items to the edges reads as deliberate alignment). |
| 4 | **Omission** | Past `maxLines`, the lowest-priority segments are dropped entirely. Better to omit a field than to make it cryptic. |

There are no hardcoded width tiers. Because wording is fixed, resizing only
changes wrapping, so the layout moves in single-line steps.

## Ordering

Segment order is fixed. Greedy flow is already line-count optimal for a fixed
order, and reordering to reclaim a few cells (a bin-packing problem) would make
fields jump between positions on every resize, destroying muscle memory.
Priority therefore decides **only what gets dropped**, never what gets
shortened or reordered.

Default priority: `ctx(10) > model(9) > cost(8) > hit(7) > in/out(6) > cache(5) > cwd(3)`

## Fields

| Field | Meaning |
|---|---|
| `model · think` | Current model and reasoning level |
| `ctx ▓▓░░ 40% 403.4k/1.0M` | Context usage; bar turns yellow at `ctxWarn`, red at `ctxDanger` |
| `in` / `out` | Cumulative input / output tokens |
| `cache r/w` | Cumulative cache reads / writes |
| `hit` | Latest cache hit rate (cache reads cost ~10% of fresh input, so this is money) |
| `$` | Cumulative cost, `sub` when a subscription covers it |
| `cwd (branch)` | Working directory and git branch |

## Layout

```
index.ts        Extension wiring: reads session state, paints the result
layout.ts       Pure layout engine: flow, balance, justify, plan
segments.ts     Session snapshot -> ordered segment list
config.ts       footer.json loading and validation
format.ts       Counts, progress bar, display width, path shortening
layout.test.ts  223 assertions
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
- line count and drop count are monotone in width, changing by at most one per column
- the context bar stays inside its configured range and never scales with width
- garbage configs (`null`, arrays, wrong types, out-of-range numbers) fall back cleanly

Measured fill across widths 20–200: **min 79%, mean 91%**.

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
  "maxGap": 4,
  "minBar": 6,
  "maxBar": 14
}
```

A malformed config degrades to defaults rather than taking the TUI down.

## Commands

- `/footer` — toggle between this footer and the built-in one
- `/reload` — re-read `footer.json` and reinstall

## Adding a field

Add one entry to the array in `segments.ts` and give it a priority in
`DEFAULT_PRIORITY`. The layout engine picks it up with no other changes.
