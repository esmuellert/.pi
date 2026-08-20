# pi themes

Five dark themes for pi, generated from the upstream Rosé Pine and Catppuccin
palettes.

| theme | |
|---|---|
| `rose-pine` | darkest and most purple; the lowest saturation of the set |
| `rose-pine-moon` | the same hues over a lighter base, for brighter rooms |
| `catppuccin-frappe` | the softest catppuccin, close to rose-pine in saturation |
| `catppuccin-macchiato` | a middle catppuccin, a little more colour than frappe |
| `catppuccin-mocha` | the popular one; darkest base, brightest accents |

## Using them

```bash
pnpm --filter pi-themes build      # writes ~/.pi/agent/themes/*.json
pi --use-theme rose-pine           # try one without saving the setting
```

Then pick one in `/settings` to keep it.

**Set your terminal background to the palette's base**, or the accents will sit
on whatever grey you had and the palette will not read as one temperature. pi
has no background token: the terminal's own background shows through.

| theme | terminal background |
|---|---|
| `rose-pine` | `#191724` |
| `rose-pine-moon` | `#232136` |
| `catppuccin-frappe` | `#303446` |
| `catppuccin-macchiato` | `#24273a` |
| `catppuccin-mocha` | `#1e1e2e` |

To compare them without restarting pi:

```bash
python3 ~/.pi/agent/themes/preview.py           # all five
python3 ~/.pi/agent/themes/preview.py rose      # just the rose-pine pair
python3 ~/.pi/agent/themes/preview.py --width 55
```

## How a palette becomes a theme

A theme is 55 colours. Written by hand, "it uses the official palette" is a
claim nobody can check, and the values that get invented are the ones no palette
publishes — for a coding agent, the tool block backgrounds, which are the
largest areas of colour on the screen.

So the palettes are npm dependencies rather than copied values:

```ts
import { flavors } from "@catppuccin/palette";
import { variants } from "@rose-pine/palette";
```

and nothing in the pipeline can name a colour. A palette is described once, in
its own vocabulary, and rules do the rest.

### 1. Semantics: what a palette means

`semantics.ts` says which of a palette's roles play which idea. Two ladders and
a dozen accents, quoting upstream wherever upstream states it:

```ts
surfaces: ["base", "surface", "overlay", "highlightMed", "highlightHigh"],
neutrals: ["muted", "subtle", "text"],
signature: "iris",       // "links, hints"; the colour the palette is known by
error:     "love",       // "errors, git delete"
comment:   "muted",      // "comments"
```

A new palette is fourteen declarations, not fifty-five decisions.

### 2. Rules: how meaning becomes tokens

`derive.ts` turns that into all 55 tokens without naming a colour, a role, or a
palette. It reads ladder positions and named accents, and measures:

- **Foreground tiers are chosen by target contrast, not by index.** rose-pine
  names three foreground greys and catppuccin six, so `neutrals[1]` is a
  different kind of grey in each. Picking the rung nearest a target makes `dim`
  equally dim on both. The targets are pi's own dark theme, so "as readable as
  what pi ships" is true by construction.
- **Text on a panel is measured against the panel**, including what state
  tinting does to it. A grey that is 4.5:1 against the page is 2.3:1 against a
  tinted tool block, which is where it stops being readable.
- **The thinking border climbs and lands on the signature.** pi paints the
  editor border with the thinking level, so the level you run at is on screen
  all session. The ramp rises by measured contrast and ends on the palette's
  identity, rather than on whatever is loudest — an earlier version ended on
  gold, which is the highest-contrast colour rose-pine has. Steps come from the
  neutrals where there are enough of them, since a border is chrome; accents
  are pulled in nearest the signature first only to make up the numbers.

`derive.test.ts` checks that this is really structural by deriving a theme from
a synthetic palette whose roles are named after floors, weather and fruit. If a
rule had a colour name in it, that palette would fail.

### The one derived value

pi's TUI has no alpha, so a tool block tinted by its state is composited down.
The alpha is not invented — both projects publish the same figure for this exact
use in their own editor ports:

```
rose-pine   diffEditor.insertedLineBackground = #9ccfd826    (0x26/255 = 0.149)
catppuccin  diffEditor.insertedLineBackground = opacity(green, 0.15)
```

The tint goes over the block's own surface rather than the page. Tinting the
page leaves tinted and untinted blocks only ~20 apart on catppuccin, where the
surface is lighter than the base and the two moves cancel.

## Files

| | |
|---|---|
| `palettes.ts` | adapter over the two upstream packages; normalises their shapes |
| `color.ts` | hex, compositing, contrast, perceptual difference |
| `semantics.ts` | what each palette's roles mean; the only per-palette file |
| `derive.ts` | the rules; names no colour, role or palette |
| `build.ts` | writes the JSON; `--check` verifies it is current |

## Tests

```bash
pnpm --filter pi-themes test
```

| file | what it holds |
|---|---|
| `palettes.test.ts` | the seam with upstream: rose-pine publishes hex without `#`, catppuccin with it |
| `color.test.ts` | compositing, and that 0.15 matches the published `0x26` |
| `semantics.test.ts` | the ladders are ordered and long enough for the rules to read |
| `derive.test.ts` | the rules are structural, proved on a synthetic palette |
| `contract.test.ts` | pi's schema and pi's own numbers, read from the installed pi |

**Nothing here is a number someone picked.** Whether two tool
backgrounds are far enough apart is measured against what pi's built-in `dark`
manages, read from the installed pi:

```
pi's dark theme: success/error 35.8, success/pending 26.2, error/pending 34.0
```

so the bar is "at least as legible as what pi ships" rather than a threshold
someone picked. The foreground tiers and the border visibility floor are read
from pi the same way. All of them move if pi retunes its theme.

Contrast ratio cannot do this job: it only compares luminance, so a red-tinted
and a blue-tinted surface of the same lightness score 1.0 while looking nothing
alike. `difference()` uses the redmean approximation instead.

## Upgrading

The palette versions are pinned in the workspace catalog. Bumping them can
change theme output, which is the point — the tests run against the new colours,
and `build.ts --check` reports the generated files as stale until you rebuild.

## Where the semantics come from

Eleven of the twelve accent declarations cite what the palette itself says the
colour is for — rose-pine's `gold` is "warnings", catppuccin's `green` is
"Strings". Those are transcribed, not chosen.

There used to be thirteen, and two of those had nothing to cite: a palette
describes code, and `heading` and `decoration` are not code. `heading` is gone
now — not replaced with a better choice, but removed. Headings are a document's
own furniture, along with list bullets, and furniture is drawn in the colour
the palette is known by. There was nothing left to choose.

Removing it fixed the fault that prompted the audit. rose-pine's `heading` had
been `gold`, which is also `warning` and the palette's loudest colour at 88%
saturation, so every markdown heading in a reply read as loudly as an error.
Headings are bold already, and underlined at level one, so the colour was never
carrying the signal alone.

Links stay separate: catppuccin cites `blue` for them, and rose-pine's
signature also being its link colour is that palette's coincidence rather than
a rule.

The tests hold rules rather than fixes: structure shares one colour and stays
clear of all three outcomes, error and success may not merge, and the signature
may not double as a state.

## Sharing is not a fault

rose-pine has six accents for thirteen roles, so some must share. What the
tests check is whether the roles that share are saying compatible things.

| shared | why it is sound |
|---|---|
| `gold` = warning + literal | upstream names it for both |
| `foam` = success + info + type | upstream, plus the vscode port |
| `pine` = keyword + callable | upstream, plus the vscode port |
| `rose` = decoration + number | forced; the last warm role |
| `iris` = signature + link + heading | the palette says "links, hints"; structure joins it |

catppuccin has fourteen accents and six spare, so it shares far less. Checked
against pi's own dark theme, three collisions that looked wrong turn out to be
what pi does too: `bashMode` with `success`, `syntaxOperator` with
`syntaxPunctuation`, and `toolOutput` with the muted group.
