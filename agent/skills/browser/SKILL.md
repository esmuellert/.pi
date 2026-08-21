---
name: browser
description: Drive a real Chrome window — read pages as text, click, type, run JavaScript, take screenshots. Use for pages that need JavaScript, sites behind a login, or anything a person would have to click through. The window is visible and can be used by hand at the same time.
---

# Browser

A visible Chrome, driven over the DevTools protocol. You and the person share
the window: they can log in, and you carry on from there.

Nothing needs installing. Node ships `fetch` and `WebSocket`, and the protocol
is those two.

## First

```bash
cd ~/.pi/agent/skills/browser/scripts
node start.mjs
```

Starts Chrome if it is not running, reports it if it is. The first run makes an
empty profile at `~/.pi/agent/browser/profile` — **ask the person to log into
whatever the task needs, once**. It is kept between sessions.

This is not their everyday Chrome profile. It cannot be: Chrome refuses to open
a debugging port on the default one, and a copied profile loses its cookies,
which are encrypted against the login keychain.

If the port is taken by a browser this did not start, `start.mjs` says so and
stops. Do not try to take it over — it may be something else entirely.

## Reading a page

```bash
node nav.mjs https://example.com        # go somewhere
node snapshot.mjs                       # the page as text
```

`snapshot.mjs` writes the accessibility tree to a file in the system temp
directory and prints the path. **Read the file rather than expecting a summary**
— use `grep` to find what you are after, or `read` with an offset.

Interactive elements are numbered `[1]`, `[2]` … Those numbers are how the
other scripts refer to them. A number is only good until the page changes; take
another snapshot after anything that navigates.

Nothing is summarised away. About a third of the nodes are folded, and only
where their text is provably written on the line above: Chrome's per-character
layout boxes, and single-child text nodes whose text is exactly their parent's
name. Every distinct string in the tree appears in the file.

## Acting

```bash
node click.mjs 20                   # click [20]
node click.mjs 20 --double
node fill.mjs 39 "search terms"     # type into [39], replacing what is there
node fill.mjs 39 "more" --append
node fill.mjs 39 "query" --enter    # and press Enter
```

Both scroll the element into view first, and both report what they acted on so
a wrong handle is visible immediately.

## When the scripts are not enough

```bash
node eval.mjs 'document.querySelectorAll("a").length'
node eval.mjs 'await fetch("/api/thing").then(r => r.json())'
```

Runs in the page, top-level `await` included. This is the way to do anything
the other scripts do not cover.

Two things to know. It runs at the page's top level, where `window`'s own
properties are already declared — `const top = …`, `name`, `self`, `status`,
`length` all fail with "Identifier has already been declared". Wrap in
`(() => { … })()` or pick another name.

And when a script needs more than a line, write it to a file and run it with
node, importing `cdp.mjs` **by absolute path** — a relative import resolves
against the script's own directory, not this one.

## Dialogs

`alert`, `confirm` and `prompt` **cannot be answered** from here, on this
machine. Chrome closes them itself as Cancel the moment they open.

That is not a timing problem, and trying harder does not help. Watched on the
socket: `javascriptDialogOpening` arrives, `handleJavaScriptDialog` with
`accept: true` goes out **one millisecond later**, and `javascriptDialogClosed`
comes back with `result: false`. The same for `confirm` and `prompt`, with and
without `userGesture`, and whether triggered synchronously or from a timer.

So a page whose flow depends on confirming a dialog cannot be driven through
that step. What works instead:

```bash
# Replace the dialog before triggering it
node eval.mjs 'window.confirm = () => true; window.prompt = () => "answer"; "patched"'
node click.mjs 7
```

The page cannot tell, unless it checks — and almost none do. Say that this was
done, since the run is then not quite what a person would have seen.

`dialog.mjs` is still there for the case where one is stuck on screen:

```bash
node dialog.mjs              # close it and reload
node dialog.mjs --no-reload
```

It reloads afterwards, because closing alone leaves the page's execution
context dead: `Runtime.enable` never returns. **Anything typed into the page is
lost**, and the handles from the last snapshot are stale.

## Pictures

```bash
node screenshot.mjs            # visible area
node screenshot.mjs --full     # whole page
```

Writes a PNG and prints the path; open it with `read`. **Prefer `snapshot.mjs`**
— it is text, and a screenshot costs well over a thousand tokens to look at.
Use a picture when the arrangement is the question and the text cannot say it.

## Other

```bash
node start.mjs --status        # what is open, without starting anything
node nav.mjs <url> --new       # a new tab
```

Every script takes `--target <id>` to act on a particular tab; without it they
use the first one open.

The browser is left running when the session ends. That is on purpose: closing
it would throw away the login state the person just typed in, and interrupt
whatever they were looking at.
