#!/usr/bin/env python3
"""Six ways a tool block header could look, on real calls from this session.

    python3 mock-title-styles.py [--width 76] [--theme rose-pine] [--only C]

A is what pi does today. The rest are candidates. Each sample shows the header
with two lines of body under it, because the complaint is about the difference
between them, not about the header alone.
"""
import json
import pathlib
import sys

THEMES = pathlib.Path.home() / ".pi/agent/themes"


def load(name):
    d = json.loads((THEMES / f"{name}.json").read_text())
    v, c = d.get("vars", {}), d.get("colors", {})
    return {k: v.get(x, x) for k, x in c.items()}, {k: x for k, x in v.items()}


rgb = lambda h: tuple(int(h.lstrip("#")[i : i + 2], 16) for i in (0, 2, 4))
FG = lambda h, s: f"\033[38;2;{';'.join(map(str, rgb(h)))}m{s}\033[39m".replace(";".join(map(str, rgb(h))), ";".join(map(str, rgb(h))))


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


def band(bgc, text, width):
    return bg(bgc, " " + text + " " * max(0, width - visible(text) - 2) + " ")


# ------------------------------------------------------------- the samples
# (verb, object, trailing detail, result sentence, state)
SAMPLES = [
    ("read", "~/.pi/agent/extensions/cd/contract.test.ts", "", "44 lines", "ok",
     ["import assert from \"node:assert/strict\";", "import { SessionManager } from \"@earendil-works/pi-coding-agent\";"]),
    ("bash", "corepack pnpm run verify", "", "9 tasks, 0.6s", "ok",
     ["pi-themes:test: ℹ pass 187", " Tasks:    9 successful, 9 total"]),
    ("write", "~/.pi/agent/extensions/themes/derive.ts", "", "10.5 kB", "ok",
     ["// The rules that turn a palette's semantics into pi's 55 tokens.", "//"]),
    ("edit", "~/.pi/agent/extensions/themes/mapping.ts", "", "2 blocks", "ok",
     ["- thinkingMax: role(\"gold\"),", "+ thinkingMax: role(\"iris\"),"]),
    ("bash", "node --experimental-strip-types build.ts", "", "exit 1", "err",
     ["Error: rose-pine has no role \"highlightHigh\"", "    at roleValue (build.ts:34:20)"]),
]

SENTENCE = {
    ("read", "ok"): lambda o, r: f"Read {r} from {o.rsplit('/', 1)[-1]}",
    ("bash", "ok"): lambda o, r: f"Ran {o.split()[0]} — {r}",
    ("bash", "err"): lambda o, r: f"Ran {o.split()[0]} — failed, {r}",
    ("write", "ok"): lambda o, r: f"Wrote {o.rsplit('/', 1)[-1]}, {r}",
    ("edit", "ok"): lambda o, r: f"Edited {o.rsplit('/', 1)[-1]}, {r} replaced",
}


def shorten(path, room):
    """Middle-ellipsis, so the filename never falls off the end."""
    if len(path) <= room or room < 12:
        return path
    head, tail = path[: room // 3], path[-(room - room // 3 - 1) :]
    return f"{head}…{tail}"


def styles(t, v, name, sample, width):
    verb, obj, _, result, state, body = sample
    block = t["toolSuccessBg"] if state == "ok" else t["toolErrorBg"]
    sentence = SENTENCE.get((verb, state), lambda o, r: f"{verb} {o} — {r}")(obj, result)
    out = []

    if name == "A":
        head = bold(fg(t["toolTitle"], verb)) + " " + fg(t["accent"], shorten(obj, width - 10))
        out = [band(block, head, width)]

    elif name == "B":
        # Swap the emphasis: the verb carries the accent, the object is body text.
        head = bold(fg(t["accent"], verb)) + " " + fg(t["toolTitle"], shorten(obj, width - 10))
        out = [band(block, head, width)]

    elif name == "C":
        # A header band: its own, darker background across the full width.
        head = bold(fg(t["accent"], verb)) + " " + fg(t["toolTitle"], shorten(obj, width - 10))
        out = [band(v.get("overlay", v.get("surface1", t["toolPendingBg"])), head, width)]

    elif name == "D":
        # A reversed chip, the way a status bar marks a mode.
        chip = bg(t["accent"], fg(block, bold(f" {verb} ")))
        out = [band(block, chip + " " + fg(t["toolTitle"], shorten(obj, width - len(verb) - 12)), width)]

    elif name == "E":
        # A sentence, in the body colour, with the result folded in.
        out = [band(block, bold(fg(t["toolTitle"], shorten(sentence, width - 4))), width)]

    elif name == "F":
        # A sentence on its own band.
        out = [band(v.get("overlay", v.get("surface1", t["toolPendingBg"])), bold(fg(t["toolTitle"], shorten(sentence, width - 4))), width)]

    for line in body:
        out.append(band(block, fg(t["toolOutput"], shorten(line, width - 4)), width))
    return out


NOTES = {
    "A": "what pi does today — bold body colour, accent object",
    "B": "same shape, emphasis swapped: the verb is the accent",
    "C": "B on its own darker band, so the header is a header",
    "D": "the verb as a filled chip, the way a status bar marks a mode",
    "E": "a sentence with the result folded in, no separate band",
    "F": "E on its own band",
}


def main():
    argv = sys.argv[1:]
    width = int(argv[argv.index("--width") + 1]) if "--width" in argv else 76
    theme = argv[argv.index("--theme") + 1] if "--theme" in argv else "rose-pine"
    only = argv[argv.index("--only") + 1].upper().split(",") if "--only" in argv else list(NOTES)

    t, v = load(theme)
    print(f"\n\033[1mtool block headers\033[0m \033[2m— {theme}, width {width}\033[0m")
    for name in only:
        if name not in NOTES:
            print(f"no style {name}; have {', '.join(NOTES)}")
            return 1
        print(f"\n\033[1m  {name}\033[0m  \033[2m{NOTES[name]}\033[0m")
        for sample in SAMPLES:
            print()
            for line in styles(t, v, name, sample, width):
                print(line)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
