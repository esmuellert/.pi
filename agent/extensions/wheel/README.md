# wheel

How far one wheel event scrolls the fullscreen transcript.

## The problem

The mouse protocol reports one event per wheel notch and says nothing about
what a notch should mean — deciding that is the application's job. pi decides
one line:

```js
wheelScrollLines = Math.max(1, options.wheelScrollLines ?? 1)
```

On a seventy-row screen that moves the transcript by a seventieth per notch.
It does not feel slow so much as unhooked from the hand, which is easy to
mistake for the renderer being slow.

Terminals scrolling their own scrollback pick a larger number for the same
gesture:

| | lines per notch |
|---|---|
| xterm | 5 — `<Btn4Down>:scroll-back(5,line,m)` |
| kitty | 5 — `wheel_scroll_multiplier` |
| Ghostty | 3 discrete, 1 precision |
| Windows | 3 — `SPI_GETWHEELSCROLLLINES` |
| **pi fullscreen** | **1** |

Regular mode is unaffected: there pi never sees the wheel at all, and the
terminal's own step applies. That asymmetry is the whole symptom.

## Why this is a setting and not a detection

Two terminals do the multiplying themselves and send several reports for one
notch — Ghostty three, kitty five. On those, pi's one line per report is
already right, and this extension would multiply it again.

Both also send many reports for a trackpad swipe, because a trackpad expresses
speed through event count rather than magnitude. A multiplier makes a swipe
fly.

The protocol offers no way to tell either apart: SGR carries a button code and
nothing else. So the number is set, not derived, and **it is wrong to keep it
after moving to a terminal that multiplies**.

## Measuring, before deciding

Three probes, because three different things were guessed wrong at least once
while working this out.

```
pnpm probe:reports    how many reports this terminal sends per notch
pnpm probe:step       how a given step feels, scrolled by hand
pnpm probe:bytes      what a scrolled row costs on this link
pnpm probe:keys       which key combinations the terminal delivers at all
```

`probe:keys` is here for the same reason as the rest: pi's fullscreen defaults
bind ctrl+shift+up/down and ctrl+shift+f, and Windows Terminal keeps that whole
range for its own shortcuts, so none of the three arrive. Nothing reports an
error — the keys simply do nothing, which reads as the feature being broken.

`~/.pi/agent/keybindings.json` adds arriving alternatives alongside the
defaults, so both work depending on the terminal.

`probe:reports` is the one that decides the setting:

| result | what to do |
|---|---|
| 1 report per notch | keep this extension |
| 3 or more | the terminal already multiplies — remove it |

`probe:bytes` exists because the first analysis here assumed a slow link and
concluded the opposite of the truth. On the link it was written on, a scrolled
row costs 30 KB and the link carries 100 MB/s, so bytes were never the
bottleneck. On mobile data they would be.

## What it does

`applyTo` sets the field and returns what happened. Three things it will not
do:

- **touch regular mode**, where the terminal already has a step of its own
- **create the field** on a TUI that lacks it
- **fail quietly** — a renamed field is reported, since the symptom of doing
  nothing is exactly the symptom being fixed

The TUI reference comes from a widget factory, which is the only place an
extension is handed it. Nothing is drawn: the widget exists to receive that
argument and is removed as soon as it has.
