#!/usr/bin/env python3
"""Is bash hard to read because it lacks colour, or because it lacks layers?

    python3 mock-bash-layers.py [--width 76] [--theme rose-pine]

pi gives six of its seven tools the same three layers — a bold verb, an accent
object, a muted modifier — and gives bash none of them: the whole command line
goes out in one colour, bolded end to end.

This shows the same commands three ways, to separate the two possible causes:

    A  what pi renders today
    B  the same three layers the other six tools use, and nothing more
    C  B plus a colour per token kind

If B reads nearly as well as C, the fix is the layering, and the full
highlighter is polish rather than the cure.
"""
import json
import pathlib
import re
import sys

THEMES = pathlib.Path.home() / ".pi/agent/themes"

rgb = lambda h: tuple(int(h.lstrip("#")[i : i + 2], 16) for i in (0, 2, 4))
bold = lambda s: f"\033[1m{s}\033[22m"


def fg(h, s):
    r, g, b = rgb(h)
    return f"\033[38;2;{r};{g};{b}m{s}\033[39m"


def visible(s):
    n, i = 0, 0
    while i < len(s):
        if s[i] == "\033":
            i = s.index("m", i) + 1
            continue
        n += 1
        i += 1
    return n


def band(bg_hex, text, width):
    r, g, b = rgb(bg_hex)
    open_bg = f"\033[48;2;{r};{g};{b}m"
    return open_bg + " " + text.replace("\033[49m", open_bg) + " " * max(0, width - visible(text) - 2) + " \033[49m"


def load(name):
    d = json.loads((THEMES / f"{name}.json").read_text())
    v, c = d.get("vars", {}), d.get("colors", {})
    return {k: v.get(x, x) for k, x in c.items()}


# --------------------------------------------------------------- tokeniser
OPERATOR = re.compile(r"^(\|\||&&|;|\||&|\d?>>?&?\d?|<<?)$")
TOKEN = re.compile(
    r"""(?P<sq>'(?:[^']|\\')*')|(?P<dq>"(?:[^"\\]|\\.)*")
      | (?P<var>\$\{[^}]*\}|\$\w+)
      | (?P<op>\|\||&&|;|\||&|\d?>>?&?\d?|<<?)
      | (?P<assign>\b[A-Za-z_]\w*=)
      | (?P<opt>--?[A-Za-z][\w-]*)
      | (?P<word>[^\s|&;<>'"$]+)
      | (?P<space>\s+)
      | (?P<other>.)""",
    re.VERBOSE,
)
BUILTIN = {"cd", "echo", "export", "source", "set", "read", "exec", "exit", "pwd"}
RESERVED = {"if", "then", "else", "fi", "for", "while", "do", "done", "case", "esac", "in"}


HEREDOC = re.compile(r"<<-?\s*(['\"]?)(\w+)\1")


def split_heredocs(command):
    """Separate shell from heredoc bodies, which are not shell at all.

    Without this a `;` or `|` inside a Python heredoc is coloured as a shell
    operator. Cross-checking 190 real commands against shell-quote, this was
    the only thing the tokeniser got wrong.
    """
    spans, pos = [], 0
    while True:
        m = HEREDOC.search(command, pos)
        if not m:
            spans.append(("shell", command[pos:]))
            return spans
        # The body starts after the line the marker is on.
        nl = command.find("\n", m.end())
        if nl == -1:
            spans.append(("shell", command[pos:]))
            return spans
        spans.append(("shell", command[pos : nl + 1]))
        marker = m.group(2)
        end = re.search(rf"^\s*{re.escape(marker)}\s*$", command[nl + 1 :], re.M)
        stop = nl + 1 + (end.end() if end else len(command) - nl - 1)
        spans.append(("body", command[nl + 1 : stop]))
        pos = stop


def parts(command):
    """Split into (kind, text). `head` is the word that starts a command."""
    out = []
    for span_kind, text in split_heredocs(command):
        if span_kind == "body":
            out.append(("body", text))
        else:
            out.extend(_parts_shell(text))
    assert "".join(t for _, t in out) == command, "tokeniser lost characters"
    return out


def _parts_shell(command):
    out, expect = [], True
    for m in TOKEN.finditer(command):
        kind, text = m.lastgroup, m.group()
        if kind == "space":
            out.append(("space", text))
            continue
        if kind == "op":
            out.append(("op", text))
            expect = text in ("|", "||", "&&", ";", "&")
            continue
        if kind == "opt":
            out.append(("opt", text))
            expect = False
            continue
        if kind in ("sq", "dq", "var", "assign"):
            out.append((kind, text))
            if kind != "assign":
                expect = False
            continue
        if kind == "other":
            # Nothing may be dropped: a highlighter that alters the command
            # shows something other than what ran.
            out.append(("arg", text))
            continue
        if expect:
            out.append(("head", text))
            expect = text in RESERVED
        else:
            out.append(("arg", text))
    return out


# ------------------------------------------------------------------ styles
def render_a(command, t):
    """What pi does now: one colour, bolded end to end."""
    return bold(fg(t["toolTitle"], f"$ {command}"))


def render_b(command, t):
    """The three layers the other six tools use, and nothing more."""
    out = [bold(fg(t["toolTitle"], "$")) + " "]
    for kind, text in parts(command):
        if kind == "space":
            out.append(text)
        elif kind == "head":
            out.append(bold(fg(t["toolTitle"], text)))  # the verb layer
        elif kind == "body":
            out.append(fg(t["mdCodeBlock"], text))  # a heredoc body is not shell
        elif kind in ("arg", "sq", "dq", "var"):
            out.append(fg(t["accent"], text))  # the object layer
        else:
            out.append(fg(t["muted"], text))  # the modifier layer
    return "".join(out)


def render_c(command, t):
    """B, plus a colour per token kind."""
    colour = {
        "head": lambda s: bold(fg(t["syntaxFunction"], s)),
        "arg": lambda s: fg(t["accent"], s),
        "opt": lambda s: fg(t["syntaxNumber"], s),
        "op": lambda s: bold(fg(t["syntaxOperator"], s)),
        "sq": lambda s: fg(t["syntaxString"], s),
        "dq": lambda s: fg(t["syntaxString"], s),
        "var": lambda s: fg(t["syntaxVariable"], s),
        "assign": lambda s: fg(t["syntaxVariable"], s),
        "body": lambda s: fg(t["mdCodeBlock"], s),
    }
    out = [bold(fg(t["toolTitle"], "$")) + " "]
    for kind, text in parts(command):
        out.append(text if kind == "space" else colour[kind](text))
    return "".join(out)


COMMANDS = [
    "corepack pnpm run verify",
    "ls -la | grep foo | wc -l",
    "node --experimental-strip-types build.ts --out ./generated",
    'git add -A && git commit -m "themes: derive from semantics" && git push',
    "cd ~/.pi/agent/extensions && pnpm verify 2>&1 | grep -E Tasks:",
    "npm pack @github/copilot --silent >/dev/null 2>&1 && tar xzf *.tgz",
    "PI=$(node -e 'x') && for f in */*.jsonl; do head -1 \"$f\"; done | wc -l",
]

STYLES = {
    "A": ("what pi renders today", render_a),
    "B": ("the other six tools' three layers, nothing more", render_b),
    "C": ("B plus a colour per token kind", render_c),
}


def main():
    argv = sys.argv[1:]
    width = int(argv[argv.index("--width") + 1]) if "--width" in argv else 76
    name = argv[argv.index("--theme") + 1] if "--theme" in argv else "rose-pine"
    t = load(name)

    print(f"\n\033[1mthe same commands, three ways\033[0m \033[2m— {name}, width {width}\033[0m")
    for key, (note, render) in STYLES.items():
        print(f"\n\033[1m  {key}\033[0m  \033[2m{note}\033[0m\n")
        for command in COMMANDS:
            print(band(t["toolSuccessBg"], render(command, t), width))
    print()

    # A multi-line command, where today's bolding is at its worst.
    heredoc = "cd ~/.pi && python3 - <<'PY'\nimport json\nprint(json.load(open('x')))\nPY"
    print(f"\033[1m  a multi-line command\033[0m \033[2m— every line is bolded today\033[0m\n")
    for key in ("A", "C"):
        print(f"  \033[2m{key}\033[0m")
        for line in STYLES[key][1](heredoc, t).split("\n"):
            print(band(t["toolSuccessBg"], line, width))
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
