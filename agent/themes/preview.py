#!/usr/bin/env python3
"""Show the generated themes side by side without restarting pi.

    python3 preview.py                 # every theme
    python3 preview.py rose            # ones whose name contains "rose"
    python3 preview.py --width 55      # at a narrower terminal width

Colours are read from the generated *.json in this directory, so this shows
what pi will show. Regenerate them with: pnpm --filter pi-themes build
"""
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).parent
BAR = "▓▓▓▓▓▓▓░░░░░░░"


def load():
    """Each theme as {token: '#rrggbb'}, resolving pi's vars indirection."""
    themes = []
    for path in sorted(HERE.glob("*.json")):
        data = json.loads(path.read_text())
        variables, colors = data.get("vars", {}), data.get("colors", {})
        themes.append((data["name"], {k: variables.get(v, v) for k, v in colors.items()}, data))
    return themes


rgb = lambda h: tuple(int(h.lstrip("#")[i : i + 2], 16) for i in (0, 2, 4))


def fg(c, s):
    r, g, b = rgb(c)
    return f"\033[38;2;{r};{g};{b}m{s}\033[0m"


def band(bgc, fgc, s, w):
    br, bg_, bb = rgb(bgc)
    fr, fgg, fb = rgb(fgc)
    body = s + " " * max(0, w - len(s))
    return f"\033[48;2;{br};{bg_};{bb}m\033[38;2;{fr};{fgg};{fb}m{body}\033[0m"


def render(name, t, data, w):
    # pi sets no background of its own: the terminal's shows through. The base
    # each palette was designed for is in the export block.
    base = data.get("export", {}).get("pageBg", "#000000")
    print(f"\n\033[1m{name}\033[0m  \033[2mset your terminal background to {base}\033[0m")
    print(fg(t["mdHr"], "─" * w))

    print(band(t["userMessageBg"], t["userMessageText"], "  why does the cache keep missing?", w))
    print()
    print(" " + fg(t["mdHeading"], "## Cache misses"))
    print(" " + fg(t["text"], "Nine cold starts, each rewriting the prefix. See the"))
    print(" " + fg(t["mdLink"], "prompt caching docs") + fg(t["text"], " for the 5 minute TTL, or set"))
    print(" " + fg(t["mdCode"], "`PI_CACHE_RETENTION=long`") + fg(t["text"], " for an hour."))
    print()
    print(band(t["toolSuccessBg"], t["toolTitle"], "  bash  grep -c cacheRead session.jsonl", w))
    print(band(t["toolSuccessBg"], t["toolOutput"], "  320", w))
    print(band(t["toolErrorBg"], t["toolTitle"], "  bash  tsc --noEmit", w))
    print(band(t["toolErrorBg"], t["toolOutput"], "  index.ts(141,8): error TS2769", w))
    print(band(t["toolPendingBg"], t["toolOutput"], "  bash  pnpm verify", w))
    print()
    print(" " + fg(t["toolDiffAdded"], '+ pi.on("session_start", apply);'))
    print(" " + fg(t["toolDiffRemoved"], '- pi.on("reload", apply);'))
    print(" " + fg(t["toolDiffContext"], "  const apply = () => {"))
    print()
    print(" " + fg(t["syntaxKeyword"], "const") + fg(t["syntaxOperator"], " = ") + fg(t["syntaxFunction"], "resolve") + fg(t["syntaxPunctuation"], "(") + fg(t["syntaxString"], '"iris"') + fg(t["syntaxPunctuation"], ");") + fg(t["syntaxComment"], "  // official"))
    print(" " + fg(t["thinkingText"], "  thinking  the reload event does not exist…"))
    print()
    print(fg(t["mdHr"], "─" * w))
    print(fg(t["dim"], "\uf07b ~/.pi  \ue0a0 main") + "  " + fg(t["accent"], "claude-opus-5 · max") + "  " + fg(t["success"], f"ctx {BAR} 48%"))
    print(fg(t["muted"], "in 470  out 256.6k  \uf1c0 60.6M/1.5M  hit 100%") + "  " + fg(t["dim"], "$46.364 sub"))


def main():
    argv = sys.argv[1:]
    width = 78
    if "--width" in argv:
        i = argv.index("--width")
        if i + 1 >= len(argv):
            print("--width needs a number")
            return 1
        width = int(argv[i + 1])
        del argv[i : i + 2]
    wanted = [a for a in argv if not a.startswith("-")]

    themes = load()
    if not themes:
        print(f"no themes in {HERE}; run: pnpm --filter pi-themes build")
        return 1
    chosen = [t for t in themes if not wanted or any(w in t[0] for w in wanted)]
    if not chosen:
        print(f"no theme matches {wanted}; have: {', '.join(n for n, _, _ in themes)}")
        return 1
    for name, tokens, data in chosen:
        render(name, tokens, data, width)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
