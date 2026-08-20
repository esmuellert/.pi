# Does Windows Terminal send image data over SSH?

**Status:** open, waiting on one experiment.

Whether pi can accept a pasted image over SSH at all turns on this. Everything
else about the feature is already known to be possible; only the transport is
in question.

## The claim

In Windows Terminal, SSH'd into a remote machine, Copilot CLI accepts a pasted
image and shows `[img]`. No tunnel, no daemon, no clipboard-syncing tool.

If that is really what happens, the terminal must be putting the image on the
wire, and pi can read the same bytes.

## The experiment

Ten seconds, and it is decisive. **In a Windows Terminal SSH session, outside
pi:**

```bash
python3 ~/.pi/agent/themes/dump-paste.py
```

Copy an image, press the paste key you use in Copilot (Ctrl+V or Alt+V), then
Ctrl-] to quit.

It prints the raw bytes the terminal sends, uninterpreted. No application's own
clipboard handling can confound it, because this is the wire itself.

## Reading the result

| what arrives | what it means | what to do |
|---|---|---|
| a large stream beginning `1b 5d 35 35 32 32` (`ESC ] 5522`) | the kitty clipboard protocol, which carries images | build it: pi can speak the same protocol in-process |
| `1b 5b 32 30 30 7e` then `1b 5b 32 30 31 7e` with nothing between | an empty bracketed paste — a signal, not data. The app then reads its own machine's clipboard, which over SSH is the remote's | the mechanism is elsewhere; find out what the remote's clipboard actually holds |
| printable text | a path was pasted | check whether that path exists on the remote |

## What is already established

Verified against pi 0.84.2's source, not assumed:

- **pi's own paste** writes the clipboard image to a temp file and inserts the
  **path** (`interactive-mode.js`, `handleClipboardPaste`). Images reach the
  model through the `read` tool, which returns image content for png, jpeg,
  webp, gif and bmp.
- **`pi.sendUserMessage(content)` accepts `ImageContent` directly** —
  `{type: "image", data: base64, mimeType}` — so an extension can attach an
  image without going through `read`.
- **pi's RPC protocol already carries images**: `prompt(message, images)`,
  `steer`, `follow_up`.
- **An extension can do the escape-sequence dance in-process**:
  `ctx.ui.onTerminalInput(handler)` reads raw terminal input and can consume it;
  `process.stdout.write` sends. Both halves are available.
- **Why Claude Code cannot do this**: it shells out to `xclip`, and the
  subprocess races the TUI for the terminal's reply. Their own issue #42712
  calls the race "unfixable from a subprocess". Anything pi does must be
  in-process, which is exactly what the two APIs above allow.
- **Why a subprocess probe fails here too**: pi owns the controlling terminal,
  so a tool call cannot open `/dev/tty` ("Device not configured"). The
  experiment has to run outside pi.

## What was ruled out

- **Reading the clipboard on the remote** (`readClipboardImage`) reads the
  remote's clipboard, not the client's. Over SSH that is empty, and the failure
  is silent — pi catches and ignores it.
- **OSC 52** carries text only, and most terminals refuse to answer a read
  query at all (about half, by terminfo.dev's 2026-05 survey).
- **The clipboard-bridge tools** — clipaste, cc-clip, clipssh,
  pi-ssh-image-clipboard — all need something installed on every machine that
  holds a clipboard, plus a reverse tunnel per connection. That fails the
  "any machine, no setup" requirement.
