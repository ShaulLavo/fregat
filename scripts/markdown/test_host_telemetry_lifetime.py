"""Actual process lifetime controls, separate from periodic CPU attribution."""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import unittest

import test_host_telemetry as fixtures
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
            os.kill(current.pid, signal.SIGKILL)

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

    def test_sigterm_at_start_return_keeps_143_and_cleanup(self):
        case = self.fixture()
        driver = case.root / "signal-driver.py"
        driver.write_text(
            """
import os, runpy, signal, sys
from host_telemetry import Collector

def observe(frame, event, _arg):
    if event == 'return' and frame.f_code is Collector.start.__code__:
        sys.setprofile(None)
        os.kill(os.getpid(), signal.SIGTERM)

sys.setprofile(observe)
runpy.run_path(CLI, run_name='__main__')
""".replace("run_path(CLI", "run_path(" + repr(str(fixtures.CLI)))
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
        receipt = case.json("receipt.json")
        self.assertEqual(receipt["status"], "incomplete")
        self.assertEqual(receipt["reason"], "interrupted")
        self.assertTrue(receipt["cleanup"])
        self.assertTrue(any(row.get("phase") == "after" for row in case.journal()))
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
