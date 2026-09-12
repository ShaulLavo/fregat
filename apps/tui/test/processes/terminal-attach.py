import fcntl
import importlib
import json
import os
import pathlib
import shlex
import struct
import sys
import termios

sys.dont_write_bytecode = True
Terminal = importlib.import_module("job-control").Terminal


def check_attach(bun, directory):
    terminal = Terminal(directory)
    group = None
    try:
        terminal.expect(b"TUI_TEST> ")
        original_modes = terminal.modes()
        terminal.send((shlex.join([bun, "test/processes/job-control-session.ts"]) + "\n").encode())
        terminal.expect(b"Live")
        group = os.tcgetpgrp(terminal.fd)
        terminal.expect_modes((False, False))
        terminal.send(b"\x0bw")
        terminal.expect(b"Open a file")
        terminal.send(b"\x0bt")
        terminal.expect(b"d detaches")
        terminal.send(b"printf '\\nEMBEDDED_%s\\n' READY\r")
        terminal.expect(b"EMBEDDED_READY")
        terminal.buffer = b""
        terminal.send(b"\x0ba")
        terminal.expect(b"\x1b[?1049h")
        terminal.send(b"nvim --clean -n +'call setline(1, \"RAW_ATTACH_NATIVE\")'\r")
        terminal.expect(b"\x1b[?1049h")
        terminal.expect(b"RAW_ATTACH_NATIVE")
        terminal.buffer = b""
        fcntl.ioctl(terminal.fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
        terminal.expect(b"[No Name]")
        terminal.send(b':echo &lines . "x" . &columns\r')
        terminal.expect(b"40x120")
        terminal.buffer = b""
        terminal.send(b"\x1dd")
        terminal.expect(b"PLATFORM")
        terminal.expect_modes((False, False))
        terminal.send(b"\x0bn")
        terminal.expect(b"Terminal 2")
        terminal.send(b"\x0bq")
        terminal.expect(b"TUI_CLOSED ")
        terminal.expect(b"TUI_TEST> ")
        terminal.expect_modes(original_modes)
        print(json.dumps({"vim": True, "resize": True, "detached": True, "resumed": True, "modesRestored": True}))
    finally:
        terminal.close(group)


if __name__ == "__main__":
    check_attach(sys.argv[1], pathlib.Path(sys.argv[2]))
