# ctrl+o loses your place in the fullscreen TUI

Open. Needs an upstream issue or PR against `pi-tui`; not reachable from an
extension.

## What happens

Scroll up to read something, press `ctrl+o`. Every block expands at once and
the transcript grows above the viewport. Nothing scrolls you — the content
slides out from under you, and what you were reading is now somewhere else.

## Why

`scrollTop` is an absolute line number, and nothing re-anchors it when the
content changes height.

```js
// pi-tui  components/scroll-view.js  updateLayout()
const maxScrollTop = Math.max(0, this.contentHeight - this.currentViewportHeight);
if (this.followingEnd)
    this.currentScrollTop = maxScrollTop;
else
    this.currentScrollTop = Math.max(0, Math.min(this.currentScrollTop, maxScrollTop));
```

Two branches: stick to the end, or clamp into the new bounds. Neither
remembers what was being read. Everything needed is in scope — the old
`contentHeight` is still on `this` when the new one arrives.

## Why this is not the same as the regular mode's version

The same complaint against the regular TUI is pi's issue #1130, answered:

> **badlogic**: "I'm afraid there's no fix for this. CTRL+O must redraw the full
> scrollback. Terminals do not expose a way to set scroll position."

Correct there. `TuiMainScreen` renders into the terminal's own scrollback,
where anything above the viewport is unaddressable, so a change up there forces
`ESC[2J` and lands at the bottom.

That premise does not hold in fullscreen. pi owns the viewport and sets the
scroll position itself — which is exactly what a commenter on the same issue
predicted the fix would be:

> **petrroll**: "Codex/claude code don't use native scrollback, no? They emulate
> scrolling up behavior while taking over the full screen."

The alternate-screen TUI was built and does own the position. Nothing went back
to `updateLayout` to use it.

Related, all about the regular mode and all closed by the auto-close bot:
#6073 (viewport jumps under tmux), #7616 (blocks growing above the viewport),
#8281 (full-screen flash), #8309 (jumps to top).

## Why an extension cannot do it

Not for lack of reach — `getPrimaryScrollView()` is available through a widget
factory, and `scrollTop`, `scrollTo()` and `render()` are all public. What is
missing is a moment to act on.

| needed | available |
|---|---|
| before the key is handled | yes — `onTerminalInput` runs before pi's handling |
| after the layout is redone | **no such event exists** |

The extension API lets you *provide* components, never *observe* rendering:
`Component` has `render`, `handleInput`, `invalidate` and no layout callback,
and the event map is entirely agent lifecycle. Rendering is coalesced through
`process.nextTick`, so an extension could only guess at the moment with a
timer — and guessing wrong restores the wrong position, which is worse than
leaving it.

## What the fix looks like

Record what the viewport top was showing before the height changes, and put it
back afterwards. One field in `ScrollView`, inside `updateLayout`.

Reproduce with: a long transcript in `--tui-mode fullscreen`, scrolled up, then
`ctrl+o`.
