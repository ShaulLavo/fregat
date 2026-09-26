import importlib
import json
import os
import pathlib
import shlex
import sys
import tempfile
import time

sys.dont_write_bytecode = True
Terminal = importlib.import_module("job-control").Terminal


def await_nvim_size(terminal, size):
    # Neovim applies a SIGWINCH on its own loop, so a query typed beside the resize can read the
    # old size. The answer goes to a file: Neovim repaints only changed cells, splitting on-screen text.
    report = pathlib.Path(tempfile.mkdtemp(prefix="platform-tui-attach-")) / "size"
    command = f':call writefile([&lines . "x" . &columns], "{report}")\r'.encode()
    deadline = time.monotonic() + 12
    reported = None
    try:
        while time.monotonic() < deadline:
            report.unlink(missing_ok=True)
            terminal.send(command)
            reported = read_report(terminal, report, deadline)
            if reported == size:
                return
        raise AssertionError(f"Neovim reported {reported!r}, expected {size!r}")
    finally:
        report.unlink(missing_ok=True)
        report.parent.rmdir()


def read_report(terminal, report, deadline):
    while time.monotonic() < deadline:
        if report.exists() and report.read_text():
            return report.read_text().strip()
        # Keep draining output so Neovim never blocks on a full terminal.
        terminal.pump(0.05)
    return None


def check_attach(bun, directory):
    terminal = Terminal(directory)
    group = None
    try:
        terminal.expect(b"TUI_TEST> ")
        original_modes = terminal.modes()
        terminal.send((shlex.join([bun, "test/processes/job-control-session.ts"]) + "\n").encode())
        terminal.expect_screen("Live")
        group = os.tcgetpgrp(terminal.fd)
        terminal.expect_modes((False, False))
        terminal.send(b"\x0bw")
        terminal.expect_screen("Open a file")
        terminal.send(b"\x0bt")
        terminal.expect_screen("d detaches")
        terminal.send(b"printf '\\nEMBEDDED_%s\\n' READY\r")
        terminal.expect_screen("EMBEDDED_READY")
        terminal.buffer = b""
        terminal.send(b"\x0ba")
        terminal.expect(b"\x1b[?1049h")
        terminal.send(b"nvim --clean -n +'call setline(1, \"RAW_ATTACH_NATIVE\")'\r")
        terminal.expect(b"\x1b[?1049h")
        terminal.expect(b"RAW_ATTACH_NATIVE")
        terminal.buffer = b""
        terminal.resize(40, 120)
        await_nvim_size(terminal, "40x120")
        terminal.buffer = b""
        terminal.send(b"\x1dd")
        terminal.expect_screen("PLATFORM")
        terminal.expect_modes((False, False))
        terminal.send(b"\x0bn")
        terminal.expect_screen("Terminal 2")
        terminal.send(b"\x0bq")
        terminal.expect(b"TUI_CLOSED ")
        terminal.expect(b"TUI_TEST> ")
        terminal.expect_modes(original_modes)
        print(json.dumps({"vim": True, "resize": True, "detached": True, "resumed": True, "modesRestored": True}))
    finally:
        terminal.close(group)


if __name__ == "__main__":
    check_attach(sys.argv[1], pathlib.Path(sys.argv[2]))
