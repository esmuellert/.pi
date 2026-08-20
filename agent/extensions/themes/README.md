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

## Why generate rather than hand-write

A theme is 55 colours. Written by hand, "it uses the official palette" is a
claim nobody can check, and the colours that get invented are the ones no
palette publishes — which for a coding agent are the tool block backgrounds,
the largest areas of colour on the screen.

So the palettes are npm dependencies, not copied values:

```ts
import { flavors } from "@catppuccin/palette";
import { variants } from "@rose-pine/palette";
```

and a token never names a colour, only a role:

```ts
mdLink: role("iris"),                    // the palette supplies the value
toolSuccessBg: tinted("surface", "foam"), // and both halves of a tint
```

There is no way to express an off-palette colour, so `mapping.test.ts` can
*prove* every emitted colour came from upstream rather than assert it.

### The one derived value

pi's TUI has no alpha, so a tool block tinted by its state has to be composited
down to an opaque colour. The alpha is not invented — both projects publish the
same figure for this exact use in their own editor ports:

```
rose-pine   diffEditor.insertedLineBackground = #9ccfd826    (0x26/255 = 0.149)
catppuccin  diffEditor.insertedLineBackground = opacity(green, 0.15)
```

The tint goes over the block's own surface, not over the page. Tinting the page
leaves the tinted and untinted blocks only ~20 apart on catppuccin, because the
surface is lighter than the base and the two moves cancel. Over the surface they
stay 43+ apart.

### Which role plays which token

Where upstream states it, the mapping follows and the comment quotes it:

```ts
error: role("love"),           // "errors, git delete"
syntaxString: role("gold"),    // "strings"
syntaxKeyword: role("mauve"),  // "Keyword"
```

Sources: [rose-pine roles](https://github.com/rose-pine/palette#roles),
[catppuccin style guide](https://github.com/catppuccin/catppuccin/blob/main/docs/style-guide.md).
Choices with no upstream counterpart — pi's thinking levels, mostly — are marked
as choices.

## Files

| | |
|---|---|
| `palettes.ts` | adapter over the two upstream packages; normalises their shapes |
| `color.ts` | hex, compositing, contrast, perceptual difference |
| `mapping.ts` | role per token, per project |
| `build.ts` | writes the JSON; `--check` verifies it is current |

## Tests

```bash
pnpm --filter pi-themes test
```

| file | what it holds |
|---|---|
| `palettes.test.ts` | the seam with upstream: rose-pine publishes hex without `#`, catppuccin with it |
| `color.test.ts` | compositing, and that 0.15 matches the published `0x26` |
| `mapping.test.ts` | the strictness proof: every colour traces to a role |
| `contract.test.ts` | pi's schema, read from the installed pi, plus readability |

Two of these are worth knowing about.

**Completeness is a compile error, not a test.** pi exports its `ThemeColor`
union, and the mapping is typed as a total `Record` over it, so a missing token
fails `tsc`:

```
mapping.ts(75,14): error TS2741: Property 'bashMode' is missing in type
'{ accent: Ref; ... }' but required in type 'Readonly<Record<Token, Ref>>'.
```

pi does not export the *background* half of that union, so those names are
repeated in `mapping.ts` and checked against pi's schema at test time. That is
the half that can drift.

**The legibility bar is pi's own theme, not a number.** Whether two tool
backgrounds are far enough apart is measured against what pi's built-in `dark`
manages, read from the installed pi:

```
pi's dark theme: success/error 35.8, success/pending 26.2, error/pending 34.0
```

so the bar is "at least as legible as what pi ships" rather than a threshold
someone picked. It also moves if pi retunes its theme.

Contrast ratio cannot do this job: it only compares luminance, so a red-tinted
and a blue-tinted surface of the same lightness score 1.0 while looking nothing
alike. `difference()` uses the redmean approximation instead.

## Upgrading

The palette versions are pinned in the workspace catalog. Bumping them can
change theme output, which is the point — the tests run against the new colours,
and `build.ts --check` reports the generated files as stale until you rebuild.
