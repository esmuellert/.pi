# Notes for pi

pi loads this file at the start of every session, so anything here survives a
new session, a compaction, or a different machine.

## Open thread: does Windows Terminal send image data over SSH?

Unresolved, and it decides whether pi can accept pasted images over SSH at all.

The claim under test: in Windows Terminal, SSH'd into a remote, Copilot CLI
accepts a pasted image and shows `[img]`. If that is what happens, the terminal
must be putting something on the wire, and pi can read the same thing.

The experiment settles it in ten seconds. **In a Windows Terminal SSH session,
outside pi**, run:

```bash
python3 ~/.pi/agent/themes/dump-paste.py
```

Copy an image, press the paste key, then Ctrl-] to quit. It prints the raw bytes
the terminal sends, uninterpreted, so no application's own clipboard handling
can confound it.

| what arrives | what it means |
|---|---|
| a large stream, `1b 5d 35 35 32 32` (`ESC ] 5522`) | the kitty clipboard protocol, which carries images. pi can do the same, in-process, via `ctx.ui.onTerminalInput` + `process.stdout.write` |
| `1b 5b 32 30 30 7e` then `1b 5b 32 30 31 7e` and nothing between | an empty bracketed paste — a signal only. The app then reads its own machine's clipboard, which over SSH is the remote's |
| printable text | a path was pasted; the question becomes whether it exists on the remote |

Background, if the thread is picked up cold:

- pi's own paste writes the clipboard image to a temp file and inserts the
  **path**; images reach the model through the `read` tool, which returns image
  content for png/jpeg/webp/gif/bmp.
- `pi.sendUserMessage(content)` accepts `ImageContent` directly
  (`{type:"image", data: base64, mimeType}`), so an extension can attach an
  image without going through `read`.
- pi's RPC protocol already carries images: `prompt(message, images)`.
- Claude Code cannot do this because it shells out to `xclip`; the subprocess
  and the TUI race for the terminal's reply. Anything pi does must be in-process.

## How this repo works

`~/.pi` is a private git repo, `esmuellert/pi-config`. `agent/extensions` is a
pnpm workspace; see its README. `node scripts/setup.mjs bootstrap` makes a new
machine match, `upgrade` moves the repo to a new pi.

## Preferences that keep coming up

- Verify against source or a real experiment. Do not guess, and do not present
  a guess as a finding.
- Never abbreviate labels in the UI to save room. Wrap instead.
- Code comments in English. Conversation in Chinese.
- Show the real output. Being caught by raw data is better than being believed.
