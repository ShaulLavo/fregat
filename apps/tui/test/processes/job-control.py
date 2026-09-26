import fcntl
import json
import os
import pathlib
import pty
import select
import shlex
import shutil
import signal
import struct
import sys
import tempfile
import termios
import time

sys.dont_write_bytecode = True
from screen import Screen  # noqa: E402 (after the bytecode switch, which must precede imports)


# Stop settles quickly; the TUI's cleanup waits up to five seconds for its terminal host.
STOP_GRACE_SECONDS = 8


def exit_on_term(_signal, _frame):
    # The test's spawn timeout sends SIGTERM; exiting normally runs `close` in each finally.
    sys.exit(143)


class Terminal:
    def __init__(self, directory):
        signal.signal(signal.SIGTERM, exit_on_term)
        self.buffer = b""
        self.trace = b""
        self.screen = Screen(32, 110)
        # Everything the run creates under the temp dir (server root, terminal host state root)
        # lands here, so `close` can find a detached host the TUI never got to stop.
        self.scratch = tempfile.mkdtemp(prefix="tui-")
        environment = dict(
            os.environ,
            TERM="xterm-256color",
            PS1="TUI_TEST> ",
            TMPDIR=self.scratch,
        )
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.chdir(directory)
            os.execve("/bin/bash", ["bash", "--noprofile", "--norc", "-i"], environment)
        self.resize(32, 110)

    def expect(self, marker):
        """Waits for bytes a program writes verbatim: shell output, or an attached program's own."""
        deadline = time.monotonic() + 12
        while marker not in self.buffer:
            self.read(deadline, lambda: f"Missing {marker!r}: {self.trace[-1500:]!r}")
        before = self.buffer[:self.buffer.index(marker)]
        self.buffer = self.buffer[self.buffer.index(marker) + len(marker):]
        return before

    def expect_screen(self, text):
        """Waits for text the TUI paints, which skips unchanged cells and so splits it in the bytes."""
        deadline = time.monotonic() + 12
        while text not in self.screen.text():
            self.read(deadline, lambda: f"Missing {text!r} on screen:\n{self.screen.text()}")
        self.buffer = b""

    def read(self, deadline, describe):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise AssertionError(describe())
        self.pump(remaining)

    def pump(self, timeout):
        if not select.select([self.fd], [], [], timeout)[0]:
            return
        chunk = os.read(self.fd, 65536)
        if not chunk:
            raise AssertionError(f"Terminal closed: {self.trace[-1500:]!r}")
        self.trace += chunk
        self.buffer += chunk
        self.screen.feed(chunk)

    def resize(self, rows, cols):
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        self.screen.resize(rows, cols)

    def send(self, value):
        os.write(self.fd, value)

    def modes(self):
        flags = termios.tcgetattr(self.fd)[3]
        return bool(flags & termios.ICANON), bool(flags & termios.ECHO)

    def expect_modes(self, modes):
        deadline = time.monotonic() + 3
        while self.modes() != modes and time.monotonic() < deadline:
            time.sleep(0.01)
        assert self.modes() == modes, (self.modes(), modes)

    def expect_group(self, group):
        deadline = time.monotonic() + 3
        while os.tcgetpgrp(self.fd) != group and time.monotonic() < deadline:
            time.sleep(0.01)
        assert os.tcgetpgrp(self.fd) == group

    def close(self, group):
        if group is not None and group != self.pid:
            stop_group(group)
        try:
            os.kill(self.pid, signal.SIGHUP)
        except ProcessLookupError:
            pass
        os.close(self.fd)
        os.waitpid(self.pid, 0)
        kill_processes(processes_naming(self.scratch))
        shutil.rmtree(self.scratch, ignore_errors=True)


def stop_group(group):
    # SIGTERM lets the TUI stop its terminal host; SIGKILL would orphan the detached host.
    if not signal_group(group, signal.SIGTERM):
        return
    signal_group(group, signal.SIGCONT)
    deadline = time.monotonic() + STOP_GRACE_SECONDS
    while time.monotonic() < deadline:
        if not signal_group(group, 0):
            return
        time.sleep(0.05)
    signal_group(group, signal.SIGKILL)


def signal_group(group, number):
    try:
        os.killpg(group, number)
    except ProcessLookupError:
        return False
    return True


def processes_naming(text):
    """Processes whose command line names `text`, with every descendant."""
    parents = {}
    matches = set()
    for entry in pathlib.Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            command = (entry / "cmdline").read_bytes()
            parents[int(entry.name)] = int((entry / "stat").read_text().rsplit(")", 1)[1].split()[1])
        except (OSError, IndexError, ValueError):
            continue
        if text.encode() in command and int(entry.name) != os.getpid():
            matches.add(int(entry.name))
    found = set(matches)
    while True:
        children = {pid for pid, parent in parents.items() if parent in found} - found
        if not children:
            return found
        found |= children


def kill_processes(pids):
    for pid in pids:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def check_editor(terminal):
    terminal.send(b"\x0bs")
    terminal.expect_screen("Search settings")
    terminal.send(b"\x1bOP")
    terminal.expect_screen("Commands")
    terminal.send(b"Edit settings JSON")
    terminal.expect_screen("▶ Edit settings JSON")
    terminal.send(b"\r")
    terminal.expect_screen("Edit settings.json")
    terminal.expect_modes((False, False))
    terminal.send(b"\x1b")
    terminal.expect_screen("Search settings")


def check_job_control(bun, directory, mode):
    terminal = Terminal(directory)
    group = None
    try:
        terminal.expect(b"TUI_TEST> ")
        shell_modes = terminal.modes()
        if mode == "shared-shell":
            terminal.send(b"bash --noprofile --norc -i\n")
            terminal.expect(b"TUI_TEST> ")
            terminal.send(b"set +m\n")
            terminal.expect(b"TUI_TEST> ")
        shell_group = os.tcgetpgrp(terminal.fd)
        entrypoint = "test/processes/job-control-session.ts"
        if mode.startswith("launcher"):
            entrypoint = "test/processes/job-control-launcher.ts"
        command = shlex.join([bun, entrypoint])
        terminal.send((command + "\n").encode())
        terminal.expect_screen("Live")
        terminal.expect_modes((False, False))
        group = os.tcgetpgrp(terminal.fd)
        if mode == "shared-shell":
            assert group == shell_group
            terminal.send(b"\x1a\x03")
            terminal.expect(b"TUI_CLOSED ")
            terminal.expect(b"TUI_TEST> ")
            terminal.expect_modes(shell_modes)
            terminal.expect_group(shell_group)
            print(json.dumps({"mode": mode, "shellProtected": True, "closed": True}))
            return
        assert group != shell_group, "The application must own a separate shell job"

        terminal.send(b"\x1a")
        terminal.expect(b"Stopped")
        terminal.expect(b"TUI_TEST> ")
        terminal.expect_modes(shell_modes)
        assert os.tcgetpgrp(terminal.fd) == shell_group

        terminal.send(b"printf 'SHELL_%s\\n' RESPONSIVE\n")
        terminal.expect(b"SHELL_RESPONSIVE\r\n")
        terminal.expect(b"TUI_TEST> ")
        terminal.send(b"fg\n")
        terminal.expect_group(group)
        terminal.expect_modes((False, False))

        check_editor(terminal)

        if mode == "launcher-term":
            os.kill(group, signal.SIGTERM)
        else:
            terminal.send(b"\x03")
        terminal.expect(b"TUI_CLOSED ")
        settings = json.loads(terminal.expect(b"\r\n"))
        assert settings["editor.fontSize"] == 13
        terminal.expect(b"TUI_TEST> ")
        terminal.expect_modes(shell_modes)
        assert os.tcgetpgrp(terminal.fd) == terminal.pid
        try:
            os.killpg(group, 0)
        except ProcessLookupError:
            pass
        else:
            raise AssertionError("The application left a process in its job group after exit")
        print(json.dumps({"mode": mode, "suspended": True, "resumed": True, "closed": True}))
    finally:
        terminal.close(group)


if __name__ == "__main__":
    check_job_control(sys.argv[1], pathlib.Path(sys.argv[2]), sys.argv[3])
