import fcntl
import json
import os
import pathlib
import pty
import select
import shlex
import signal
import struct
import sys
import termios
import time


class Terminal:
    def __init__(self, directory):
        self.buffer = b""
        self.trace = b""
        environment = dict(
            os.environ,
            TERM="xterm-256color",
            PS1="TUI_TEST> ",
        )
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.chdir(directory)
            os.execve("/bin/bash", ["bash", "--noprofile", "--norc", "-i"], environment)
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", 32, 110, 0, 0))

    def expect(self, marker):
        deadline = time.monotonic() + 12
        while marker not in self.buffer:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise AssertionError(f"Missing {marker!r}: {self.trace[-1500:]!r}")
            if not select.select([self.fd], [], [], remaining)[0]:
                continue
            chunk = os.read(self.fd, 65536)
            if not chunk:
                raise AssertionError(f"Terminal closed: {self.trace[-1500:]!r}")
            self.trace += chunk
            self.buffer += chunk
        before = self.buffer[:self.buffer.index(marker)]
        self.buffer = self.buffer[self.buffer.index(marker) + len(marker):]
        return before

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
            try:
                os.killpg(group, signal.SIGKILL)
            except ProcessLookupError:
                pass
        try:
            os.kill(self.pid, signal.SIGHUP)
        except ProcessLookupError:
            pass
        os.close(self.fd)
        os.waitpid(self.pid, 0)


def check_editor(terminal):
    terminal.send(b"\x0bs")
    terminal.expect(b"Search settings")
    terminal.send(b"\x1bOP")
    terminal.expect(b"Commands")
    terminal.send(b"Edit settings JSON")
    terminal.expect(b"Edit settings JSON")
    terminal.send(b"\r")
    terminal.expect(b"Edit settings.json")
    terminal.expect_modes((False, False))
    terminal.send(b"\x1b")
    terminal.expect(b"Search settings")


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
        terminal.expect(b"Live")
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
