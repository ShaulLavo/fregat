"""Deterministic signal boundaries, with no real process creation or signals."""

from __future__ import annotations

import signal
import subprocess
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

import host_telemetry as telemetry
from host_telemetry_os import ProcessCounter


class IdentityTests(unittest.TestCase):
    def test_unsupported_identity_refuses_signal_before_pid_reuse(self):
        owned = ProcessCounter(42, 10, 42, 100, 0)
        replacement = ProcessCounter(42, 1, 42, 200, 0)
        world = {42: owned}
        signals = []

        def observe():
            observed = SimpleNamespace(processes=tuple(world.values()))
            world[42] = replacement
            return observed

        def send(pid, signum):
            signals.append((world[pid].identity, signum))

        with (
            patch.object(telemetry, "os", SimpleNamespace(kill=send)),
            patch.object(telemetry, "snapshot", side_effect=observe),
            self.assertRaisesRegex(RuntimeError, "process handles"),
        ):
            telemetry.kill_identity(owned.identity)
        self.assertEqual(signals, [])

    def test_group_reuse_is_observed_without_signaling_replacement(self):
        replacement = ProcessCounter(42, 1, 42, 200, 0)
        current = SimpleNamespace(processes=(replacement,))
        signals = []
        with (
            patch.object(
                telemetry.os, "killpg", side_effect=lambda *args: signals.append(args)
            ),
            patch.object(telemetry, "snapshot", return_value=current),
            patch.object(telemetry, "command_text", return_value="42 S"),
        ):
            self.assertFalse(telemetry.cleanup_group(42, {(42, 100)}))
        self.assertEqual(signals, [])

    def test_pidfd_signal_keeps_opened_identity_when_pid_is_reused(self):
        owned = ProcessCounter(42, 10, 42, 100, 0)
        replacement = ProcessCounter(42, 1, 42, 200, 0)
        world = {42: owned}
        handles = {}
        signals = []
        closed = []

        def open_handle(pid):
            handles[7] = world[pid]
            return 7

        def observe():
            observed = SimpleNamespace(processes=tuple(world.values()))
            world[42] = replacement
            return observed

        def send(fd, signum):
            signals.append((handles[fd].identity, signum))

        fake_os = SimpleNamespace(pidfd_open=open_handle, close=closed.append)
        fake_signal = SimpleNamespace(pidfd_send_signal=send, SIGKILL=signal.SIGKILL)
        with (
            patch.object(telemetry, "os", fake_os),
            patch.object(telemetry, "signal", fake_signal),
            patch.object(telemetry, "snapshot", side_effect=observe),
        ):
            telemetry.kill_identity(owned.identity)
        self.assertEqual(signals, [(owned.identity, signal.SIGKILL)])
        self.assertEqual(closed, [7])
        self.assertEqual(world[42], replacement)

    def test_unsupported_containment_refuses_producer_launch(self):
        containment = SimpleNamespace(
            supported=False, adopted=[], cleanup=Mock(return_value=False)
        )
        collector = SimpleNamespace(record=Mock(), finish=Mock(), interrupted=False)
        args = SimpleNamespace(interval_seconds=1, timeout_seconds=1)
        with (
            patch.object(telemetry, "LaunchContainment", return_value=containment),
            patch.object(
                telemetry.subprocess,
                "Popen",
                side_effect=RuntimeError("producer launch reached"),
            ) as launch,
            self.assertRaisesRegex(RuntimeError, "supported launch containment"),
        ):
            telemetry.launch_capture(args, collector, ["fake-producer"])
        launch.assert_not_called()
        containment.cleanup.assert_called_once_with()
        collector.finish.assert_called_once_with()
        self.assertFalse(collector.cleaning)

    def test_reaped_launch_root_never_signals_reused_pid_or_group(self):
        child = subprocess.Popen.__new__(subprocess.Popen)
        child._child_created = False
        child._waitpid_lock = threading.Lock()
        child.returncode = 0
        child.pid = 42
        child._sigint_wait_secs = 0
        containment = SimpleNamespace(adopted=[], cleanup=Mock(return_value=True))
        collector = SimpleNamespace(
            finish=Mock(), record=Mock(), capture_owned={(42, 100)}
        )
        replacement = ProcessCounter(42, 1, 42, 200, 0)
        with (
            patch.object(telemetry.os, "kill") as pid_signal,
            patch.object(telemetry.os, "killpg") as group_signal,
            patch.object(
                telemetry,
                "snapshot",
                return_value=SimpleNamespace(processes=(replacement,)),
            ),
            patch.object(telemetry, "command_text", return_value="42 S"),
        ):
            cleanup, _exited = telemetry.finish_launch(child, containment, collector)
        self.assertFalse(cleanup)
        pid_signal.assert_not_called()
        group_signal.assert_not_called()
        containment.cleanup.assert_called_once_with()

    def test_capture_refuses_external_or_automatic_child_reaping(self):
        args = SimpleNamespace(
            out=MagicMock(),
            report=Mock(),
            kind="browser",
            command=["{hostEvidence}"],
            adapter_config=Mock(),
        )
        args.report.resolve.return_value.exists.return_value = False
        with (
            patch.object(telemetry, "adapter_config", return_value=["fake-adapter"]),
            patch.object(telemetry.signal, "getsignal", return_value=signal.SIG_IGN),
            patch.object(telemetry, "Collector") as collector,
            patch.object(telemetry, "write_json") as write,
        ):
            self.assertEqual(telemetry.run_capture(args), 1)
        collector.assert_not_called()
        receipt = write.call_args.args[1]
        self.assertEqual(receipt["status"], "incomplete")
        self.assertFalse(receipt["launched"])
        self.assertEqual(receipt["message"], "Capture requires exclusive child reaping")

    def test_unsupported_launch_receipt_keeps_cleanup_false(self):
        collector = SimpleNamespace(
            out=Path("fake-out"),
            identity={"host": "fake-host"},
            failures=[],
            observations=[{}],
            group=None,
            sample=Mock(),
            record=Mock(),
            finish=Mock(),
            interrupted=False,
        )
        args = SimpleNamespace(
            kind="browser",
            command=["{hostEvidence}"],
            interval_seconds=1,
            timeout_seconds=1,
        )
        containment = SimpleNamespace(
            supported=False, adopted=[], cleanup=Mock(return_value=False)
        )
        with (
            patch.object(telemetry, "LaunchContainment", return_value=containment),
            patch.object(
                telemetry.subprocess,
                "Popen",
                side_effect=RuntimeError("producer launch reached"),
            ) as launch,
            patch.object(telemetry.time, "sleep"),
            patch.object(telemetry, "write_json") as write,
            patch.object(telemetry, "finalize") as finalize,
        ):
            self.assertEqual(
                telemetry.execute_capture(args, collector, "fake-report"), 1
            )
        launch.assert_not_called()
        finalize.assert_not_called()
        receipt = write.call_args.args[1]
        self.assertEqual(receipt["status"], "incomplete")
        self.assertFalse(receipt["launched"])
        self.assertFalse(receipt["cleanup"])


if __name__ == "__main__":
    unittest.main()
