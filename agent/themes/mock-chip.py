#!/usr/bin/env python3
"""Chip candidates for the tool block header, on real calls from this session.

    python3 mock-chip.py [--width 66] [--theme rose-pine] [--only C,F]

pi's title text is left exactly as it is, so anything that repeats the verb is
out: the title already starts with it. That leaves the chip two jobs it can do
without saying anything twice — mark where the header starts, and carry the one
thing the title never says, which is how the call turned out.

Needs a Nerd Font for the icon variants. A missing glyph still measures one
column, so it shows as a box rather than breaking the layout.
"""
import importlib.util
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).parent
THEMES = pathlib.Path.home() / ".pi/agent/themes"

spec = importlib.util.spec_from_file_location("titles", HERE / "mock-tool-titles.py")
titles = importlib.util.module_from_spec(spec)
spec.loader.exec_module(titles)

# Font Awesome range, which every Nerd Font carries. The footer already uses
# F07B and F1C0 from here.
TOOL_ICON = {
    "read": "\uf15c",   # file-text
    "edit": "\uf044",   # pencil-square
    "write": "\uf0c7",  # save
    "bash": "\uf120",   # terminal
    "grep": "\uf002",   # search
    "find": "\uf002",
    "ls": "\uf07b",     # folder
}
STATE_ICON = {"ok": "\uf00c", "err": "\uf00d", "run": "\uf1ce"}  # check, times, notch
STATE_ASCII = {"ok": "✓", "err": "✗", "run": "·"}

rgb = lambda h: tuple(int(h.lstrip("#")[i : i + 2], 16) for i in (0, 2, 4))


def fg(h, s):
    r, g, b = rgb(h)
    return f"\033[38;2;{r};{g};{b}m{s}\033[39m"


def bg(h, s):
    r, g, b = rgb(h)
    return f"\033[48;2;{r};{g};{b}m{s}\033[49m"


def bold(s):
    return f"\033[1m{s}\033[22m"


def visible(s):
    n, i = 0, 0
    while i < len(s):
        if s[i] == "\033":
            i = s.index("m", i) + 1
            continue
        n += 1
        i += 1
    return n


def load(name):
    d = json.loads((THEMES / f"{name}.json").read_text())
    v, c = d.get("vars", {}), d.get("colors", {})
    return {k: v.get(x, x) for k, x in c.items()}, v


def band(bgc, text, width):
    """One line of the block, painted edge to edge.

    Anything inside that ends its own background — a filled chip, or a clipped
    string — would otherwise end the band's too, leaving the padding bare. Inner
    resets are rewritten to return to this band rather than to none.
    """
    r, g, b = rgb(bgc)
    open_bg = f"\033[48;2;{r};{g};{b}m"
    body = text.replace("\033[49m", open_bg)
    return open_bg + " " + body + " " * max(0, width - visible(text) - 2) + " \033[49m"


def clip(styled, width):
    out, seen, i = "", 0, 0
    while i < len(styled) and seen < width:
        if styled[i] == "\033":
            j = styled.index("m", i) + 1
            out += styled[i:j]
            i = j
            continue
        out += styled[i]
        seen += 1
        i += 1
    # No background reset here: band() owns the background for the whole line.
    return out + "\033[39m\033[22m"


# ------------------------------------------------------------------ chips
def chip(name, tool, state, t, block):
    accent = t["accent"]
    mark = {"ok": t["success"], "err": t["error"], "run": t["muted"]}[state]
    tool_icon = TOOL_ICON.get(tool, TOOL_ICON["bash"])

    if name == "A":  # quietest thing that is still a marker
        return fg(mark, "▍") + " "
    if name == "B":  # kind, in the accent
        return fg(accent, tool_icon) + "  "
    if name == "C":  # outcome, which the title never says
        return fg(mark, STATE_ICON[state]) + "  "
    if name == "D":  # outcome and kind, side by side
        return fg(mark, "▍") + " " + fg(accent, tool_icon) + "  "
    if name == "E":  # one glyph: position marks the header, shape the kind, colour the outcome
        return fg(mark, tool_icon) + "  "
    if name == "F":  # kind filled, so the header edge is unmistakable
        return bg(accent, fg(block, f" {tool_icon} ")) + " "
    if name == "G":  # the same, filled in the outcome colour
        return bg(mark, fg(block, f" {tool_icon} ")) + " "
    if name == "H":  # no font dependency at all
        return fg(mark, STATE_ASCII[state]) + "  "
    if name == "I":  # a rule down the left, the way a quote block is marked
        return fg(mark, "┃") + " "
    raise KeyError(name)


NOTES = {
    "A": "a bar in the outcome colour, nothing else",
    "B": "the tool's icon, in the accent",
    "C": "a tick, cross or spinner: the one thing the title never says",
    "D": "outcome bar and kind icon, side by side",
    "E": "one glyph — shape is the kind, colour is the outcome",
    "F": "the kind filled, so the header edge is unmistakable",
    "G": "the same, filled in the outcome colour",
    "H": "ASCII only, for a terminal without a Nerd Font",
    "I": "a rule down the left, the way a quote is marked",
}

SAMPLES = [
    ("read", titles.format_read_call, {"file_path": "/Users/yanuo/.pi/agent/extensions/cd/contract.test.ts"}, "ok",
     ["import assert from \"node:assert/strict\";", "import { describe, it } from \"node:test\";"]),
    ("bash", titles.format_bash_call, {"command": "corepack pnpm run verify"}, "ok",
     [" Tasks:    9 successful, 9 total"]),
    ("edit", titles.format_edit_call, {"file_path": "/Users/yanuo/.pi/agent/extensions/themes/derive.ts"}, "ok",
     ["+ thinkingMax: role(\"iris\"),"]),
    ("bash", titles.format_bash_call, {"command": "node --experimental-strip-types build.ts"}, "err",
     ["Error: rose-pine has no role \"highlightHigh\""]),
    ("grep", titles.format_grep_call, {"pattern": "toolSuccessBg", "path": "/Users/yanuo/.pi/agent", "glob": "*.js"}, "run",
     ["searching…"]),
]


def main():
    argv = sys.argv[1:]
    width = int(argv[argv.index("--width") + 1]) if "--width" in argv else 66
    name = argv[argv.index("--theme") + 1] if "--theme" in argv else "rose-pine"
    only = [x.strip().upper() for x in argv[argv.index("--only") + 1].split(",")] if "--only" in argv else list(NOTES)

    t, _ = load(name)
    theme = titles.Theme(t)
    state_bg = {"ok": t["toolSuccessBg"], "err": t["toolErrorBg"], "run": t["toolPendingBg"]}

    print(f"\n\033[1mchip candidates\033[0m \033[2m— {name}, width {width}\033[0m")
    for variant in only:
        if variant not in NOTES:
            print(f"no variant {variant}; have {', '.join(NOTES)}")
            return 1
        print(f"\n\033[1m  {variant}\033[0m  \033[2m{NOTES[variant]}\033[0m\n")
        for tool, fn, args, state, body in SAMPLES:
            block = state_bg[state]
            mark = chip(variant, tool, state, t, block)
            head = fn(args, theme).split("\n")[0]
            print(band(block, clip(mark + head, width - 2), width))
            for line in body:
                print(band(block, " " * visible(mark) + fg(t["toolOutput"], line[: width - visible(mark) - 4]), width))
            print(band(block, "", width))
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
