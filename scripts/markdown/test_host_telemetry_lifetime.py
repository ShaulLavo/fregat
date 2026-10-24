"""Actual process lifetime controls, separate from periodic CPU attribution."""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import unittest

import test_host_telemetry as fixtures
from host_telemetry import Collector, kill_identity
from host_telemetry_os import snapshot


@unittest.skipUnless(sys.platform == "linux", "Kernel adoption requires Linux")
class LifetimeTests(unittest.TestCase):
    def fixture(self):
        case = fixtures.TelemetryTests(methodName="runTest")
        case.setUp()
        self.addCleanup(case.doCleanups)
        return case

    def stop_fixture_identity(self, file):
        if not file.exists():
            return
        identity = tuple(json.loads(file.read_text()))
        current = next(
            (p for p in snapshot().processes if p.identity == identity), None
        )
        if current is not None and current.live:
            kill_identity(current.identity)

    def check_escape(self, intermediate):
        case = self.fixture()
        identity_file = case.root / "escape.json"
        self.addCleanup(self.stop_fixture_identity, identity_file)
        code = """
import json, os, sys, time
from pathlib import Path
from host_telemetry_os import linux_process
Path(sys.argv[1]).write_text(json.dumps(linux_process(os.getpid(), os.sysconf('SC_CLK_TCK')).identity))
time.sleep(45)
"""
        spawn = """
child = subprocess.Popen([sys.executable, '-c', CODE, IDENTITY], start_new_session=True,
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
""".replace("CODE", repr(code)).replace("IDENTITY", repr(str(identity_file)))
        if intermediate:
            spawn = """
child = subprocess.Popen([sys.executable, '-c', SOURCE], start_new_session=True,
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
child.wait(timeout=3)
""".replace("SOURCE", repr("import subprocess, sys\n" + spawn))
        # The child is born after the last periodic observation and leaves its group.
        case.capture.write_text(
            fixtures.CAPTURE.replace("time.sleep(0.65)", "time.sleep(2.65)") + spawn
        )
        command = case.command()
        command[command.index("--interval-seconds") + 1] = "2"
        result = subprocess.run(
            command,
            env=case.env,
            capture_output=True,
            text=True,
            timeout=12,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(case.json("receipt.json")["status"], "bound")
        self.assertTrue(case.json("receipt.json")["cleanup"])
        containment = next(
            row for row in case.journal() if row["kind"] == "containment-cleanup"
        )
        self.assertTrue(containment["proven"])
        self.assertTrue(containment["adopted"])
        self.assertFalse(
            any(
                p.live and list(p.identity) in containment["adopted"]
                for p in snapshot().processes
            )
        )
        samples = [row for row in case.journal() if row["kind"] == "sample"]
        self.assertFalse(
            any(
                identity in row["owned"]
                for row in samples
                for identity in containment["adopted"]
            )
        )

    def test_unobserved_detached_child_is_adopted_and_reaped(self):
        self.check_escape(False)

    def test_unobserved_double_fork_is_adopted_and_reaped(self):
        self.check_escape(True)

    def check_start_signal(self, target, event):
        case = self.fixture()
        driver = case.root / "signal-driver.py"
        driver.write_text(
            """
import os, runpy, signal, sys, threading
from host_telemetry import Collector
previous = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM)}
TARGET = TARGET_EXPRESSION

def observe(frame, event, _arg):
    if event == EVENT_NAME and frame.f_code is TARGET.__code__:
        sys.setprofile(None)
        os.kill(os.getpid(), signal.SIGTERM)

sys.setprofile(observe)
try:
    runpy.run_path(CLI, run_name='__main__')
finally:
    assert all(signal.getsignal(sig) == handler for sig, handler in previous.items())
    assert threading.enumerate() == [threading.main_thread()]
    print('handlers restored; monitor stopped', flush=True)
""".replace("TARGET_EXPRESSION", target)
            .replace("EVENT_NAME", repr(event))
            .replace("run_path(CLI", "run_path(" + repr(str(fixtures.CLI)))
        )
        command = case.command(mode="hang")
        command[1] = str(driver)
        result = subprocess.run(
            command,
            env=case.env,
            capture_output=True,
            text=True,
            timeout=12,
            check=False,
        )
        self.assertEqual(result.returncode, 143, result.stderr)
        self.assertIn("handlers restored; monitor stopped", result.stdout)
        receipt = case.json("receipt.json")
        self.assertEqual(receipt["status"], "incomplete")
        self.assertEqual(receipt["reason"], "interrupted")
        self.assertTrue(receipt["cleanup"])
        self.assertTrue(any(row.get("phase") == "after" for row in case.journal()))
        self.assertFalse((case.root / "telemetry/quiet-host.json").exists())

    def test_sigterm_at_start_return_keeps_143_and_cleanup(self):
        self.check_start_signal("Collector.start", "return")

    def test_sigterm_at_thread_start_entry_keeps_143_and_cleanup(self):
        self.check_start_signal("threading.Thread.start", "call")

    def test_sigterm_at_thread_start_return_keeps_143_and_cleanup(self):
        self.check_start_signal("threading.Thread.start", "return")

    def check_finish_repeat(self, started):
        case = self.fixture()
        case.command()
        out = case.root / "telemetry"
        out.mkdir()
        collector = Collector(out, json.loads(case.config.read_text())["command"])
        self.addCleanup(collector.close)
        collector.sample("before")
        if started:
            collector.start(os.getpid(), 0.15)
        collector.finish()
        first = (out / "observations.jsonl").read_bytes()
        collector.finish()
        self.assertEqual((out / "observations.jsonl").read_bytes(), first)
        self.assertEqual(sum(row.get("phase") == "after" for row in case.journal()), 1)
        self.assertTrue(collector.stop.is_set())
        if collector.thread is not None:
            self.assertFalse(collector.thread.is_alive())
        collector.close()
        collector.close()
        self.assertTrue(collector.journal.closed)

    def test_finish_before_start_is_idempotent(self):
        self.check_finish_repeat(False)

    def test_finish_after_start_is_idempotent(self):
        self.check_finish_repeat(True)

    def test_after_write_failure_still_closes_monitor_and_restores_handlers(self):
        case = self.fixture()
        driver = case.root / "after-failure-driver.py"
        driver.write_text(
            """
import errno, os, runpy, signal, sys, threading
from host_telemetry import Collector
previous = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM)}
collector = None

def observe(frame, event, _arg):
    global collector
    if event != 'call' or frame.f_code is not Collector.finish.__code__:
        return
    sys.setprofile(None)
    collector = frame.f_locals['self']
    fd = os.open('/dev/full', os.O_WRONLY)
    try:
        os.dup2(fd, collector.journal.fileno())
    finally:
        os.close(fd)

sys.setprofile(observe)
try:
    runpy.run_path(CLI, run_name='__main__')
except OSError as error:
    assert error.errno == errno.ENOSPC, error
else:
    raise AssertionError('actual after journal failure was swallowed')
assert collector is not None
assert collector.after_attempted
assert collector.journal.closed
assert threading.enumerate() == [threading.main_thread()]
assert all(signal.getsignal(sig) == handler for sig, handler in previous.items())
print('after write failed; handlers restored; monitor stopped; journal closed')
""".replace("run_path(CLI", "run_path(" + repr(str(fixtures.CLI)))
        )
        command = case.command()
        command[1] = str(driver)
        result = subprocess.run(
            command,
            env=case.env,
            capture_output=True,
            text=True,
            timeout=12,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("after write failed; handlers restored", result.stdout)
        self.assertFalse((case.root / "telemetry/quiet-host.json").exists())

    def test_containment_refuses_preexisting_child_and_restores_reaper_state(self):
        case = self.fixture()
        driver = case.root / "containment-driver.py"
        driver.write_text("""
import ctypes, subprocess, sys
from host_telemetry_lifetime import LaunchContainment
libc = ctypes.CDLL(None, use_errno=True)
previous = ctypes.c_int()
assert libc.prctl(37, ctypes.byref(previous), 0, 0, 0) == 0
child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])
try:
    try:
        LaunchContainment()
    except RuntimeError as error:
        assert 'preexisting children' in str(error)
    else:
        raise AssertionError('preexisting child accepted')
    assert child.poll() is None
finally:
    child.kill()
    child.wait(timeout=3)
containment = LaunchContainment()
assert containment.cleanup()
current = ctypes.c_int()
assert libc.prctl(37, ctypes.byref(current), 0, 0, 0) == 0
assert previous.value == current.value
print('preexisting child preserved; subreaper restored')
""")
        result = subprocess.run(
            [sys.executable, str(driver)],
            env=case.env,
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("subreaper restored", result.stdout)

    def test_unsupported_lifetime_capability_cannot_certify_cleanup(self):
        case = self.fixture()
        driver = case.root / "unsupported-driver.py"
        driver.write_text("""
import sys
from host_telemetry_lifetime import LaunchContainment
sys.platform = 'unsupported-control'
containment = LaunchContainment()
assert not containment.supported
assert containment.cleanup() is False
""")
        result = subprocess.run(
            [sys.executable, str(driver)],
            env=case.env,
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
