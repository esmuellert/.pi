#!/usr/bin/env python3
"""Every kind of tool block, with a command-line tokeniser applied to bash.

    python3 mock-highlight.py [--width 76] [--theme rose-pine] [--only bash]

pi highlights read and write output through highlight.js, but the bash tool
does not highlight at all: the command is bold and the output is one flat
colour. Turning highlight.js on would not help much — its bash grammar is for
scripts, and on real command lines it colours about a tenth of the characters,
none of them the parts you look for.

This tokenises the command line instead, the way zsh-syntax-highlighting and
fish do: the command, its flags, its paths and its operators, rather than the
language constructs a script would have.

Colours come from the generated theme, so nothing here invents one.
"""
import json
import os
import pathlib
import re
import sys

THEMES = pathlib.Path.home() / ".pi/agent/themes"

# ------------------------------------------------------------------ theme
def load(name):
    data = json.loads((THEMES / f"{name}.json").read_text())
    variables, colors = data.get("vars", {}), data.get("colors", {})
    return {k: variables.get(v, v) for k, v in colors.items()}


rgb = lambda h: tuple(int(h.lstrip("#")[i : i + 2], 16) for i in (0, 2, 4))


def fg(h, s):
    r, g, b = rgb(h)
    return f"\033[38;2;{r};{g};{b}m{s}\033[39m"


def bgc(h, s):
    r, g, b = rgb(h)
    return f"\033[48;2;{r};{g};{b}m{s}\033[49m"


bold = lambda s: f"\033[1m{s}\033[22m"
under = lambda s: f"\033[4m{s}\033[24m"


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
    """One line of the block, painted edge to edge; inner resets return here."""
    r, g, b = rgb(bg_hex)
    open_bg = f"\033[48;2;{r};{g};{b}m"
    body = text.replace("\033[49m", open_bg)
    return open_bg + " " + body + " " * max(0, width - visible(text) - 2) + " \033[49m"


# ------------------------------------------------- command line tokeniser
# zsh-syntax-highlighting's vocabulary, which is what a reader scans for:
# the command, whether it exists, its flags, its paths, its operators.
BUILTIN = {"cd", "echo", "export", "source", ".", "set", "unset", "read", "eval",
           "exec", "exit", "return", "shift", "test", "printf", "pwd", "alias"}
RESERVED = {"if", "then", "else", "elif", "fi", "for", "while", "until", "do", "done",
            "case", "esac", "function", "select", "in", "time"}
OPERATOR = {"|", "||", "&&", ";", "&", ">", ">>", "<", "<<", "2>&1", ">&2", "|&"}

TOKEN = re.compile(
    r"""(?P<comment>\#[^\n]*)
      | (?P<sq>'(?:[^']|\\')*')
      | (?P<dq>"(?:[^"\\]|\\.)*")
      | (?P<heredoc><<-?\s*'?\w+'?)
      | (?P<subst>\$\((?:[^()]|\([^)]*\))*\)|`[^`]*`)
      | (?P<var>\$\{[^}]*\}|\$\w+)
      | (?P<redir>\d?>>?&?\d?|<<?)
      | (?P<op>\|\||&&|;|\||&)
      | (?P<assign>\b[A-Za-z_]\w*=)
      | (?P<opt>--?[A-Za-z][\w-]*)
      | (?P<word>[^\s|&;<>#'"$`]+)
      | (?P<space>\s+)
    """,
    re.VERBOSE,
)


def looks_like_path(word):
    return word.startswith(("/", "./", "../", "~")) or "/" in word


def exists(word):
    try:
        return os.path.exists(os.path.expanduser(word.split(":")[0]))
    except OSError:
        return False


def highlight_command(command, t):
    """Colour a command line. `expect_command` tracks where a command may start."""
    out = []
    expect_command = True
    for m in TOKEN.finditer(command):
        kind = m.lastgroup
        text = m.group()

        if kind == "space":
            out.append(text)
            continue
        if kind == "comment":
            out.append(fg(t["syntaxComment"], text))
            continue
        if kind in ("sq", "dq"):
            out.append(fg(t["syntaxString"], text))
            expect_command = False
            continue
        if kind == "heredoc":
            out.append(fg(t["syntaxOperator"], text))
            expect_command = False
            continue
        if kind in ("subst", "var"):
            out.append(fg(t["syntaxVariable"], text))
            expect_command = False
            continue
        if kind in ("redir", "op"):
            out.append(bold(fg(t["syntaxOperator"], text)))
            # After a pipe or a list operator the next word is a command again.
            expect_command = text in ("|", "||", "&&", ";", "&")
            continue
        if kind == "assign":
            out.append(fg(t["syntaxVariable"], text))
            continue
        if kind == "opt":
            out.append(fg(t["syntaxNumber"], text))
            expect_command = False
            continue

        # a bare word
        if expect_command:
            if text in RESERVED:
                out.append(bold(fg(t["syntaxKeyword"], text)))
                # `do`, `then` and friends are followed by another command.
                expect_command = True
            elif text in BUILTIN:
                out.append(bold(fg(t["syntaxKeyword"], text)))
                expect_command = False
            else:
                out.append(bold(fg(t["syntaxFunction"], text)))
                expect_command = False
        elif looks_like_path(text):
            painted = fg(t["accent"], text)
            out.append(under(painted) if exists(text) else painted)
        elif "*" in text or "?" in text:
            out.append(fg(t["syntaxNumber"], text))
        else:
            out.append(fg(t["toolTitle"], text))
    return "".join(out)


# ------------------------------------------------------ the tool renderers
def path_display(p, t):
    home = str(pathlib.Path.home())
    short = f"~{p[len(home):]}" if p.startswith(home) else p
    return fg(t["accent"], short)


def title_for(tool, args, t, highlight):
    """pi's own title shapes, with bash optionally tokenised."""
    verb = lambda v: bold(fg(t["toolTitle"], v))
    if tool == "read":
        r = args.get("range", "")
        return f"{verb('read')} {path_display(args['path'], t)}" + (fg(t["warning"], r) if r else "")
    if tool == "edit":
        return f"{verb('edit')} {path_display(args['path'], t)}"
    if tool == "write":
        return f"{verb('write')} {path_display(args['path'], t)}"
    if tool == "ls":
        return f"{verb('ls')} {path_display(args['path'], t)}"
    if tool == "grep":
        return (verb("grep") + " " + fg(t["accent"], f"/{args['pattern']}/")
                + fg(t["toolOutput"], f" in {args['path']}")
                + (fg(t["toolOutput"], f" ({args['glob']})") if args.get("glob") else ""))
    if tool == "find":
        return (verb("find") + " " + fg(t["accent"], args["pattern"])
                + fg(t["toolOutput"], f" in {args['path']}"))
    if tool == "bash":
        body = highlight_command(args["command"], t) if highlight else bold(args["command"])
        return bold(fg(t["toolTitle"], "$ ")) + body
    raise KeyError(tool)


ICON = {"read": "\uf15c", "bash": "\uf120", "edit": "\uf044", "write": "\uf0c7",
        "ls": "\uf07b", "grep": "\uf002", "find": "\uf002"}


# ----------------------------------------------------- real calls, this chat
HOME = str(pathlib.Path.home())
CALLS = [
    ("read", {"path": f"{HOME}/.pi/agent/extensions/cd/relocate.ts"}, "ok",
     [("code", "export function relocateSession("), ("code", "\tsourceFile: string,")]),
    ("read", {"path": f"{HOME}/.pi/agent/themes/rose-pine.json", "range": ":1-40"}, "ok",
     [("code", '{"name": "rose-pine", "vars": {')]),
    ("bash", {"command": "corepack pnpm run verify"}, "ok",
     [("out", " Tasks:    12 successful, 12 total")]),
    ("bash", {"command": "grep -rhoE '\"(border|borderAccent)\"' \"$PI/dist\" --include='*.js' | sort | uniq -c"}, "ok",
     [("out", "   5 \"border\""), ("out", "   2 \"borderMuted\"")]),
    ("bash", {"command": "cd ~/.pi/agent/extensions/themes && node --experimental-strip-types build.ts --out ./generated"}, "err",
     [("err", 'Error: rose-pine has no role "highlightHigh"')]),
    ("bash", {"command": "git add -A && git commit -q -m \"themes: derive from semantics\" && git push -q origin main"}, "ok",
     [("out", "3af6674 docs: move the open SSH image thread")]),
    ("bash", {"command": "PI=$(node -e 'console.log(1)') && for f in */*.jsonl; do head -1 \"$f\"; done | wc -l"}, "run",
     [("out", "…")]),
    ("bash", {"command": "npm pack @github/copilot --silent >/dev/null 2>&1 && tar xzf *.tgz && du -sh package/"}, "ok",
     [("out", " 20K\tpackage/")]),
    ("edit", {"path": f"{HOME}/.pi/agent/extensions/cd/relocate.ts"}, "ok",
     [("del", '- \tparentSession: sourceFile,'), ("add", '+ \tconst { parentSession: _dropped, ...carried } = original;')]),
    ("write", {"path": f"{HOME}/.pi/docs/todo/ssh-image-paste.md"}, "ok",
     [("code", "# Does Windows Terminal send image data over SSH?")]),
    ("ls", {"path": f"{HOME}/.pi/agent/themes"}, "ok",
     [("out", "rose-pine.json"), ("out", "preview.py")]),
    ("grep", {"pattern": "toolSuccessBg", "path": f"{HOME}/.pi/agent", "glob": "*.js"}, "run",
     [("out", "searching…")]),
    ("find", {"pattern": "*.test.ts", "path": f"{HOME}/.pi/agent/extensions"}, "ok",
     [("out", "cd/cd.test.ts"), ("out", "themes/derive.test.ts")]),
]


def body_line(kind, text, t):
    return {
        "out": lambda: fg(t["toolOutput"], text),
        "err": lambda: fg(t["error"], text),
        "add": lambda: fg(t["toolDiffAdded"], text),
        "del": lambda: fg(t["toolDiffRemoved"], text),
        "code": lambda: fg(t["mdCodeBlock"], text),
    }[kind]()


def main():
    argv = sys.argv[1:]
    width = int(argv[argv.index("--width") + 1]) if "--width" in argv else 76
    name = argv[argv.index("--theme") + 1] if "--theme" in argv else "rose-pine"
    only = argv[argv.index("--only") + 1].split(",") if "--only" in argv else None

    t = load(name)
    block = {"ok": t["toolSuccessBg"], "err": t["toolErrorBg"], "run": t["toolPendingBg"]}
    mark = {"ok": t["success"], "err": t["error"], "run": t["muted"]}

    print(f"\n\033[1mevery tool block\033[0m \033[2m— {name}, width {width}\033[0m")
    print("\033[2mbash is shown twice: as pi renders it now, then tokenised.\033[0m")

    for tool, args, state, body in CALLS:
        if only and tool not in only:
            continue
        bg_hex = block[state]
        chip = fg(mark[state], ICON[tool]) + "  "
        print()
        if tool == "bash":
            print(band(bg_hex, chip + title_for(tool, args, t, highlight=False), width))
            print(band(bg_hex, "   " + fg(t["dim"], "↓ tokenised"), width))
        print(band(bg_hex, chip + title_for(tool, args, t, highlight=True), width))
        for kind, text in body:
            print(band(bg_hex, "   " + body_line(kind, text, t), width))
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
