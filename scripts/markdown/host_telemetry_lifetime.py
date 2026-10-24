"""Prove launch lifetime through kernel adoption, independently of CPU sampling."""

from __future__ import annotations

import ctypes
import os
import select
import signal
import sys
import time
from pathlib import Path

from host_telemetry_os import linux_process


class LaunchContainment:
    def __init__(self):
        self.supported = sys.platform == "linux"
        self.previous = ctypes.c_int()
        self.adopted: list[tuple[int, int]] = []
        self.cleanup_result: bool | None = None
        if not self.supported:
            return
        if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
            raise RuntimeError("Launch containment requires kernel process handles")
        self.ticks = os.sysconf("SC_CLK_TCK")
        self.libc = ctypes.CDLL(None, use_errno=True)
        self.check_prctl(37, ctypes.byref(self.previous))
        if self.children():
            raise RuntimeError("Launch containment requires no preexisting children")
        self.check_prctl(36, 1)

    def check_prctl(self, operation, value):
        if self.libc.prctl(operation, value, 0, 0, 0):
            raise OSError(ctypes.get_errno(), "Subreaper containment is unavailable")

    def children(self) -> list[int]:
        return list(
            {
                int(pid)
                for task in Path("/proc/self/task").iterdir()
                for pid in (task / "children").read_text().split()
            }
        )

    def stop_child(self, pid: int, deadline: float) -> None:
        fd = os.pidfd_open(pid)
        try:
            # An unreaped direct child retains its PID until our exact waitpid.
            process = linux_process(pid, self.ticks)
            if process.parent_pid != os.getpid():
                raise RuntimeError("Adopted process ownership changed")
            self.adopted.append(process.identity)
            signal.pidfd_send_signal(fd, signal.SIGKILL)
            remaining = max(0, deadline - time.monotonic())
            if not select.select([fd], [], [], remaining)[0]:
                raise TimeoutError("Adopted child did not stop during cleanup")
            os.waitpid(pid, 0)
        finally:
            os.close(fd)

    def cleanup(self) -> bool:
        if self.cleanup_result is not None:
            return self.cleanup_result
        self.cleanup_result = False
        if not self.supported:
            return False
        try:
            self.drain()
        finally:
            self.check_prctl(36, self.previous)
        self.cleanup_result = True
        return True

    def drain(self) -> None:
        deadline = time.monotonic() + 2
        children = self.children()
        while children:
            if time.monotonic() >= deadline:
                raise TimeoutError("Launch descendants remain during cleanup")
            for pid in children:
                self.stop_child(pid, deadline)
            children = self.children()
