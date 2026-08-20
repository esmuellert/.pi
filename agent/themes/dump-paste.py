#!/usr/bin/env python3
"""Show exactly what the terminal sends. Run this over SSH and paste an image.

    python3 dump-paste.py

Whatever your terminal puts on the wire when you press a key or paste arrives
here as raw bytes. Nothing is interpreted, so this cannot be fooled by an
application's own clipboard handling: it is the wire itself.

Press Ctrl-] to quit.
"""
import os
import sys
import termios
import time
import tty

QUIT = b"\x1d"  # Ctrl-]

NAMED = {
    b"\x1b[200~": "bracketed paste START",
    b"\x1b[201~": "bracketed paste END",
}


def describe(chunk: bytes) -> str:
    for seq, name in NAMED.items():
        if chunk == seq:
            return f"  <- {name}"
    if chunk.startswith(b"\x1b]5522"):
        return "  <- OSC 5522 (kitty clipboard, carries images)"
    if chunk.startswith(b"\x1b]52"):
        return "  <- OSC 52 (clipboard, text only)"
    return ""


def main() -> int:
    fd = sys.stdin.fileno()
    if not os.isatty(fd):
        print("run this in a terminal, not through a pipe")
        return 1

    print(__doc__)
    print("Bracketed paste is ON. Copy an image, then press Ctrl+V / Alt+V / Ctrl+Shift+V.\n")
    sys.stdout.write("\033[?2004h")  # ask the terminal to bracket pastes
    sys.stdout.flush()

    old = termios.tcgetattr(fd)
    total = 0
    try:
        tty.setraw(fd)
        while True:
            chunk = os.read(fd, 65536)
            if not chunk or QUIT in chunk:
                break
            total += len(chunk)
            stamp = time.strftime("%H:%M:%S")
            head = chunk[:64]
            printable = "".join(chr(b) if 32 <= b < 127 else "." for b in head)
            sys.stdout.write(
                f"{stamp}  {len(chunk):>7} bytes  {head.hex(' ')[:96]}\r\n"
                f"          {printable}{describe(chunk)}\r\n"
            )
            sys.stdout.flush()
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)
        sys.stdout.write("\033[?2004l\n")
        sys.stdout.flush()
    print(f"{total} bytes received in total.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
