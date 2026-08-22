---
name: browser
description: Drive a real Chrome window — read pages as an accessibility tree, click, type, upload, wait, and run JavaScript. Use for anything on a site that needs a logged-in session, a rendered page, or interaction: reading a page that needs JavaScript, filling a form, checking how something looks, or working through a site the way a person would.
---

# browser

A real Chrome window, driven from the shell. It stays open between commands and
keeps its logins, so you can watch what is happening and take over by hand.

```bash
cd ~/.pi/agent/skills/browser/scripts
node start.mjs
```

The first run installs Playwright and says so — a few seconds, once per
machine, nothing to do. It also makes a profile of its own: log into whatever
you need, once, by hand in that window, and it is kept from then on.

## The loop

Take a snapshot, read it, act on the numbers it printed.

```bash
node nav.mjs github.com/BurntSushi/ripgrep
node snapshot.mjs          # writes a file, prints the path
```

The snapshot is the page's accessibility tree — every frame, nothing
summarised. Read it or grep it. Interactive elements are numbered:

```
  [20] link "Issues"
  [39] combobox "Search Issues"
```

Those numbers are what the other commands take. **They belong to the snapshot
that printed them**; after anything changes the page, take another.

## Acting

```bash
node click.mjs 20                      # --double, --right, --force
node fill.mjs 39 "memory leak"         # --enter, --append, --type
node press.mjs Escape                  # --handle <n>, --times <n>
node select.mjs 12 "Option 1"          # a <select>, by visible label
node hover.mjs 8                       # menus that need the pointer
node upload.mjs 5 ./report.pdf         # the one thing eval cannot do
```

Each waits for the element to be attached, visible, still, enabled, and to
actually receive the click — retrying until it does. A button under a cookie
banner fails and says so rather than being clicked in its place. `--force`
skips those checks.

## Waiting

```bash
node wait.mjs --text "Hello World!"    # --timeout <ms>
node wait.mjs --gone "Loading..."
node wait.mjs --idle                   # network goes quiet
```

`nav.mjs` already waits for the page to settle. Use these for content that
arrives later.

## Looking

```bash
node screenshot.mjs                    # --full, --handle <n>, --tab <n>
```

For layout, whether an image rendered, what a chart shows — things words do not
carry. The snapshot is better for everything else.

## Tabs

```bash
node tabs.mjs                          # * marks where commands go
node nav.mjs example.com --new
node snapshot.mjs --tab 1
node tabs.mjs --close 1
```

Without `--tab`, commands act on the tab that is in front.

## Dialogs

`alert`, `confirm` and `prompt` stop the page, so the answer has to be arranged
before the thing that opens them — one command, not two.

```bash
node dialog.mjs --click 7                        # accept
node dialog.mjs --click 7 --dismiss
node dialog.mjs --eval 'confirmThing()' --text "answer"
```

Any other command that happens to open one answers **Cancel**: Playwright
closes a dialog nobody is listening for, and only this script listens. So if a
click produces "You clicked: Cancel" when you did not ask for it, that is why —
use `dialog.mjs` for that click instead.

## JavaScript

```bash
node eval.mjs 'document.title'
node eval.mjs 'const rows = [...document.querySelectorAll("tr")]; return rows.length;'
node eval.mjs 'document.body.innerHTML' --frame 1
```

The escape hatch for anything the other commands do not cover. A bare
expression or a body with `return`, both work.

`--frame` reaches inside an iframe. Chrome does not expose every editor as
interactive — TinyMCE's body is a `generic` with no properties, so the snapshot
gives it no number — and this is the way in.

## What the page logged

```bash
node console.mjs --eval 'doTheThing()' --for 3000
node console.mjs --for 5000
```

Console output, uncaught errors and failed requests exist only while something
is listening, and every command here is a separate process. So this runs the
action itself, with the listeners already on.

## Notes

An accessible name can contain characters you cannot see — icon fonts put
private-use glyphs in them, so one real page has `button "\uf090 Login"`. Copy
the number, not the name.

The window is left open when a command finishes. Closing it would throw away
the login state.
