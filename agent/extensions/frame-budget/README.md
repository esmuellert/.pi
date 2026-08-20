# frame-budget

What a still frame may cost, and how to measure it without flaking.

Shared by the packages that draw, so that "fast enough" means the same thing in
each of them and is arrived at the same way.

## Why an absolute budget

Every extension that draws is asked to draw again on every frame, so anything
it does per render is done once per keystroke.

The failure this guards against already happened. `tool-blocks` re-tokenised
every bash block on every frame; in a session holding eight hundred of them a
still frame cost two thirds of a second, and it read as the session having
grown too large rather than as a bug in an extension.

A scaling assertion would not have caught it. Both the broken and the fixed
version cost time proportional to the blocks on screen — what changed was the
constant, by a factor of six hundred. Only an absolute budget sees that.

The cost of an absolute budget is that it depends on the machine. Hence the
headroom below.

## The numbers, and where they come from

| | |
|---|---|
| `FRAME_MS` | `1000 / 60` — a frame at 60fps. A ceiling, not a target |
| `BUDGET_MS` | `FRAME_MS / 4` — pi's own rendering needs the rest |

Measured on the machine this was written on, the two packages that draw use
about a twelfth of the budget between them. That gap is the headroom a slower
or busier machine has before this starts crying wolf.

## Measuring

`frame(draw)` returns the cost of one still frame in milliseconds.

- **The minimum of seven attempts**, not the mean. Noise only ever adds time,
  so the smallest reading is closest to what the work really costs. A mean
  fails whenever something else on the machine happens to run.
- **The first draw is discarded**, since it pays for whatever is cached on
  first use, and a still frame by definition is not the first one.

`overBudget(cost, budget?)` returns the failure message, or `undefined`. It
reports the cost against the frame as well as the budget, and says what it
means for the person typing.

## Held by tests

`frame-budget.test.ts` checks the measurement itself, since every other
performance test trusts it: that it reports roughly the real cost, that a
single slow attempt does not leak in, that a cold first draw does not either,
and that it draws often enough for a cache to show.

Both consumers' tests were checked by putting the regression back:

```
tool-blocks   cache removed   718.8ms   4313% of a frame   ✖
footer        session rescanned 14.9ms    89% of a frame   ✖
```
