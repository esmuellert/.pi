#!/usr/bin/env python3
"""Render pi's tool titles exactly as the built-in tools produce them.

    python3 mock-tool-titles.py [--width 78] [--theme rose-pine]

Every format function here is a transcription of the corresponding one in
pi 0.84.2, so what this prints is what pi prints. The calls are real ones from
the session that produced this file.

    core/tools/render-utils.js   shortenPath, renderToolPath, invalidArgText
    core/tools/read.js           formatReadCall, formatCompactReadCall, formatReadLineRange
    core/tools/edit.js           formatEditCall
    core/tools/write.js          formatWriteCall
    core/tools/bash.js           formatBashCall
    core/tools/ls.js             formatLsCall
    core/tools/find.js           formatFindCall
    core/tools/grep.js           formatGrepCall
"""
import json
import os
import pathlib
import sys

THEMES = pathlib.Path.home() / ".pi/agent/themes"


def load(name):
    data = json.loads((THEMES / f"{name}.json").read_text())
    variables, colors = data.get("vars", {}), data.get("colors", {})
    return {k: variables.get(v, v) for k, v in colors.items()}


def rgb(h):
    return tuple(int(h.lstrip("#")[i : i + 2], 16) for i in (0, 2, 4))


class Theme:
    """The subset of pi's Theme that the format functions touch."""

    def __init__(self, tokens):
        self.t = tokens

    def fg(self, token, text):
        r, g, b = rgb(self.t[token])
        return f"\033[38;2;{r};{g};{b}m{text}\033[39m"

    def bold(self, text):
        return f"\033[1m{text}\033[22m"


# ------------------------------------------------------- render-utils.js
def shorten_path(path):
    if not isinstance(path, str):
        return ""
    home = os.path.expanduser("~")
    return f"~{path[len(home):]}" if path.startswith(home) else path


def invalid_arg_text(theme):
    return theme.fg("error", "[invalid arg]")


def render_tool_path(raw, theme, empty_fallback=None):
    if raw is None:
        return invalid_arg_text(theme)
    value = raw or empty_fallback
    if not value:
        return theme.fg("toolOutput", "...")
    # linkPath wraps this in OSC 8 when the terminal supports hyperlinks.
    return theme.fg("accent", shorten_path(value))


# --------------------------------------------------------------- read.js
def format_read_line_range(args, theme):
    if args.get("offset") is None and args.get("limit") is None:
        return ""
    start = args.get("offset") or 1
    end = start + args["limit"] - 1 if args.get("limit") is not None else ""
    return theme.fg("warning", f":{start}{f'-{end}' if end else ''}")


def format_read_call(args, theme):
    path = render_tool_path(args.get("file_path") or args.get("path"), theme)
    return f"{theme.fg('toolTitle', theme.bold('read'))} {path}{format_read_line_range(args, theme)}"


def format_compact_read_call(kind, label, args, theme):
    hint = theme.fg("dim", " (ctrl+o to expand)")
    if kind == "skill":
        return (
            theme.fg("customMessageLabel", "\033[1m[skill]\033[22m ")
            + theme.fg("customMessageText", label)
            + format_read_line_range(args, theme)
            + hint
        )
    return (
        theme.fg("toolTitle", theme.bold(f"read {kind}"))
        + " "
        + theme.fg("accent", label)
        + format_read_line_range(args, theme)
        + hint
    )


# ---------------------------------------------------------- edit/write.js
def format_edit_call(args, theme):
    path = render_tool_path(args.get("file_path") or args.get("path"), theme)
    return f"{theme.fg('toolTitle', theme.bold('edit'))} {path}"


def format_write_call(args, theme):
    path = render_tool_path(args.get("file_path") or args.get("path"), theme)
    return f"{theme.fg('toolTitle', theme.bold('write'))} {path}"


# --------------------------------------------------------------- bash.js
def format_bash_call(args, theme):
    command = args.get("command")
    timeout = args.get("timeout")
    suffix = theme.fg("muted", f" (timeout {timeout}s)") if timeout else ""
    if command is None:
        display = invalid_arg_text(theme)
    elif command:
        display = command
    else:
        display = theme.fg("toolOutput", "...")
    return theme.fg("toolTitle", theme.bold(f"$ {display}")) + suffix


# ------------------------------------------------------- ls/find/grep.js
def format_ls_call(args, theme):
    path = render_tool_path(args.get("path"), theme, empty_fallback=".")
    text = f"{theme.fg('toolTitle', theme.bold('ls'))} {path}"
    if args.get("limit") is not None:
        text += theme.fg("toolOutput", f" (limit {args['limit']})")
    return text


def format_find_call(args, theme):
    pattern = args.get("pattern")
    path = shorten_path(args.get("path") or ".")
    text = (
        theme.fg("toolTitle", theme.bold("find"))
        + " "
        + (invalid_arg_text(theme) if pattern is None else theme.fg("accent", pattern or ""))
        + theme.fg("toolOutput", f" in {path}")
    )
    if args.get("limit") is not None:
        text += theme.fg("toolOutput", f" (limit {args['limit']})")
    return text


def format_grep_call(args, theme):
    pattern = args.get("pattern")
    path = shorten_path(args.get("path") or ".")
    text = (
        theme.fg("toolTitle", theme.bold("grep"))
        + " "
        + (invalid_arg_text(theme) if pattern is None else theme.fg("accent", f"/{pattern or ''}/"))
        + theme.fg("toolOutput", f" in {path}")
    )
    if args.get("glob"):
        text += theme.fg("toolOutput", f" ({args['glob']})")
    if args.get("limit") is not None:
        text += theme.fg("toolOutput", f" limit {args['limit']}")
    return text


# --------------------------------------------------- real calls, this chat
STORE = (
    "/Users/yanuo/Library/pnpm/store/v11/links/@earendil-works/pi-coding-agent/0.84.2/"
    "686092e01fbe03c52bb154695b457edb230167c334e85339f4491e22bc1e8979/node_modules/"
    "@earendil-works/pi-coding-agent"
)

CALLS = [
    ("read a file in the repo", "toolSuccessBg", format_read_call, {"file_path": "/Users/yanuo/.pi/agent/extensions/cd/contract.test.ts"}),
    ("read pi's own source", "toolSuccessBg", format_read_call, {"file_path": f"{STORE}/docs/themes.md"}),
    ("read a slice", "toolSuccessBg", format_read_call, {"file_path": f"{STORE}/docs/themes.md", "offset": 60, "limit": 160}),
    ("write a new file", "toolSuccessBg", format_write_call, {"file_path": "/Users/yanuo/.pi/agent/extensions/themes/derive.ts"}),
    ("edit an existing one", "toolSuccessBg", format_edit_call, {"file_path": "/Users/yanuo/.pi/agent/extensions/themes/mapping.ts"}),
    ("a short shell call", "toolSuccessBg", format_bash_call, {"command": "corepack pnpm run verify"}),
    ("the one that failed", "toolErrorBg", format_bash_call, {"command": "node --experimental-strip-types build.ts --out ./generated"}),
    ("a long one-liner", "toolSuccessBg", format_bash_call, {"command": 'grep -rhoE \'"(border|borderAccent|borderMuted)"\' "$PI/dist" --include=\'*.js\' | sort | uniq -c'}),
    ("a heredoc, still running", "toolPendingBg", format_bash_call, {"command": "cd ~/.pi/agent/extensions/themes && python3 - <<'PY'\nimport json,colorsys\nrp=json.load(open('/tmp/rp.json'))\nfor v in ('main','moon'):\n    print(v, rp[v])\nPY"}),
    ("args still streaming", "toolPendingBg", format_bash_call, {"command": ""}),
    ("a malformed call", "toolErrorBg", format_read_call, {"file_path": None}),
    ("reading a skill", "toolSuccessBg", lambda a, t: format_compact_read_call("skill", "web-research", a, t), {}),
    ("list a directory", "toolSuccessBg", format_ls_call, {"path": "/Users/yanuo/.pi/agent/themes"}),
    ("search for a symbol", "toolSuccessBg", format_grep_call, {"pattern": "toolSuccessBg", "path": f"{STORE}/dist", "glob": "*.js"}),
    ("find by name", "toolSuccessBg", format_find_call, {"pattern": "*theme*", "path": f"{STORE}/dist", "limit": 20}),
]


def band(bg_hex, text, width):
    """One line of the tool Box: bgFn painted across the full width."""
    r, g, b = rgb(bg_hex)
    # Pad to width by display length, ignoring escape codes.
    visible = 0
    i = 0
    while i < len(text):
        if text[i] == "\033":
            i = text.index("m", i) + 1
            continue
        visible += 1
        i += 1
    pad = " " * max(0, width - visible - 2)
    return f"\033[48;2;{r};{g};{b}m " + text + pad + " \033[49m"


def main():
    argv = sys.argv[1:]
    width, name = 78, "rose-pine"
    if "--width" in argv:
        width = int(argv[argv.index("--width") + 1])
    if "--theme" in argv:
        name = argv[argv.index("--theme") + 1]

    tokens = load(name)
    theme = Theme(tokens)
    print(f"\n\033[1mpi {name} tool titles\033[0m \033[2m— transcribed from pi 0.84.2, width {width}\033[0m\n")

    for label, bg, fn, args in CALLS:
        print(f"\033[2m{label}\033[0m")
        title = fn(args, theme)
        # Box paints line by line, so an embedded newline becomes several bands.
        for line in title.split("\n"):
            print(band(tokens[bg], line, width))
        print()


if __name__ == "__main__":
    sys.exit(main())
