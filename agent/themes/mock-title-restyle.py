#!/usr/bin/env python3
"""Does styling alone fix the header, with pi's title text left exactly as is?

    python3 mock-title-restyle.py [--width 76] [--theme rose-pine]

The title strings come from mock-tool-titles.py, which transcribes pi 0.84.2, so
nothing here rewrites what pi says. Only the framing around it changes. The last
two samples are the cases that made the current header hard to read, kept in so
the answer is not just about the easy ones.
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


def load(name):
    d = json.loads((THEMES / f"{name}.json").read_text())
    v, c = d.get("vars", {}), d.get("colors", {})
    return {k: v.get(x, x) for k, x in c.items()}, v


rgb = lambda h: tuple(int(h.lstrip("#")[i : i + 2], 16) for i in (0, 2, 4))


def fg(h, s):
    r, g, b = rgb(h)
    return f"\033[38;2;{r};{g};{b}m{s}\033[39m"


def bg(h, s):
    r, g, b = rgb(h)
    return f"\033[48;2;{r};{g};{b}m{s}\033[49m"


def visible(s):
    n, i = 0, 0
    while i < len(s):
        if s[i] == "\033":
            i = s.index("m", i) + 1
            continue
        n += 1
        i += 1
    return n


def wrap(styled, width):
    """Break a styled string at width, the way a full-width band has to."""
    out, line, seen, i = [], "", 0, 0
    while i < len(styled):
        if styled[i] == "\033":
            j = styled.index("m", i) + 1
            line += styled[i:j]
            i = j
            continue
        if seen == width:
            out.append(line)
            line, seen = "", 0
        line += styled[i]
        seen += 1
        i += 1
    if line:
        out.append(line)
    return out or [""]


def band(bgc, text, width):
    return bg(bgc, " " + text + " " * max(0, width - visible(text) - 2) + " ")


STORE = titles.STORE
SAMPLES = [
    ("read", titles.format_read_call, {"file_path": "/Users/yanuo/.pi/agent/extensions/cd/contract.test.ts"}, "ok",
     ["import assert from \"node:assert/strict\";"]),
    ("bash", titles.format_bash_call, {"command": "corepack pnpm run verify"}, "ok",
     [" Tasks:    9 successful, 9 total"]),
    ("edit", titles.format_edit_call, {"file_path": "/Users/yanuo/.pi/agent/extensions/themes/mapping.ts"}, "ok",
     ["+ thinkingMax: role(\"iris\"),"]),
    ("bash failing", titles.format_bash_call, {"command": "node --experimental-strip-types build.ts"}, "err",
     ["Error: rose-pine has no role \"highlightHigh\""]),
    ("read, long path", titles.format_read_call, {"file_path": f"{STORE}/docs/themes.md"}, "ok",
     ["> pi can create themes. Ask it to build one for your setup."]),
    ("bash, a heredoc", titles.format_bash_call,
     {"command": "cd ~/.pi/agent/extensions/themes && python3 - <<'PY'\nimport json\nprint(json.load(open('/tmp/rp.json')))\nPY"}, "ok",
     ["{'main': [...], 'moon': [...]}"]),
]


def render(style, t, v, title, body, state, width):
    block = t["toolSuccessBg"] if state == "ok" else t["toolErrorBg"]
    header = v.get("overlay") or v.get("surface1") or t["toolPendingBg"]
    out = []
    for i, raw in enumerate(title.split("\n")):
        for line in wrap(raw, width - 2):
            if style == "A":
                out.append(band(block, line, width))
            elif style == "C":
                out.append(band(header, line, width))
            elif style == "D":
                # The chip only makes sense on the first line of the first line.
                if i == 0 and not out:
                    chip = bg(t["accent"], fg(block, "\033[1m ▍ \033[22m"))
                    out.append(band(block, chip + " " + line, width))
                else:
                    out.append(band(block, "    " + line, width))
    for line in body:
        out.append(band(block, fg(t["toolOutput"], line[: width - 4]), width))
    return out


NOTES = {
    "A": "pi today: the header shares the block's background",
    "C": "the same text on its own band",
    "D": "the same text behind a chip, block background unchanged",
}


def main():
    argv = sys.argv[1:]
    width = int(argv[argv.index("--width") + 1]) if "--width" in argv else 76
    name = argv[argv.index("--theme") + 1] if "--theme" in argv else "rose-pine"
    t, v = load(name)
    theme = titles.Theme(t)

    print(f"\n\033[1mstyling only, pi's title text untouched\033[0m \033[2m— {name}, width {width}\033[0m")
    for style, note in NOTES.items():
        print(f"\n\033[1m  {style}\033[0m  \033[2m{note}\033[0m")
        for label, fn, args, state, body in SAMPLES:
            print(f"\n  \033[2m{label}\033[0m")
            for line in render(style, t, v, fn(args, theme), body, state, width):
                print(line)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
