"""Owned helper lifetime controls through the CLI's prelaunch exits."""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import unittest

import test_host_telemetry as fixtures
from host_telemetry_lifetime import LaunchContainment
from host_telemetry_os import linux_process

HELPER = """
import json, os, sys, time
from pathlib import Path
from host_telemetry_os import linux_process
process = linux_process(os.getpid(), os.sysconf('SC_CLK_TCK'))
Path(sys.argv[1]).write_text(json.dumps(dict(identity=process.identity,
    parentPid=process.parent_pid, group=process.group)))
time.sleep(30)
"""

SPAWN = """
import json, os, signal, subprocess, sys, time
from pathlib import Path
identity_file = Path(IDENTITY_FILE)
if not identity_file.exists():
    parent_fd = os.pidfd_open(os.getppid())
    child = subprocess.Popen([sys.executable, '-c', HELPER_CODE, str(identity_file)],
                             stdout=OUTPUT, stderr=OUTPUT)
    deadline = time.monotonic() + 2
    while not identity_file.exists():
        if time.monotonic() >= deadline:
            raise TimeoutError('owned helper readiness')
        time.sleep(0.01)
    ACTION
"""


@unittest.skipUnless(
    sys.platform == "linux"
    and hasattr(os, "pidfd_open")
    and hasattr(signal, "pidfd_send_signal"),
    "Helper lifetime controls require Linux pidfds and kernel adoption",
)
class PrelaunchTests(unittest.TestCase):
    def fixture(self):
        case = fixtures.TelemetryTests(methodName="runTest")
        case.setUp()
        self.addCleanup(case.doCleanups)
        # The outer subreaper retains failed-control orphans for exact-child teardown.
        owner = LaunchContainment()
        self.addCleanup(owner.cleanup)
        return case

    def source(self, case, action, output):
        return (
            SPAWN.replace("IDENTITY_FILE", repr(str(case.root / "helper.json")))
            .replace("HELPER_CODE", repr(HELPER))
            .replace("OUTPUT", output)
            .replace("ACTION", action)
        )

    def run_cli(self, case, command):
        process = subprocess.Popen(
            command,
            env=case.env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.addCleanup(self.close_cli, process)
        stdout, stderr = process.communicate(timeout=12)
        identity = json.loads((case.root / "helper.json").read_text())
        print(
            json.dumps(
                {
                    "test": self.id(),
                    "cliPid": process.pid,
                    "exitCode": process.returncode,
                    "helper": identity,
                    "stdout": stdout,
                    "stderr": stderr,
                }
            ),
            flush=True,
        )
        return process, identity

    def close_cli(self, process):
        process.kill()
        process.wait(timeout=2)
        process.stdout.close()
        process.stderr.close()

    def assert_reaped(self, case, identity):
        pid, started = identity["identity"]
        try:
            current = linux_process(pid, os.sysconf("SC_CLK_TCK"))
        except FileNotFoundError:
            current = None
        self.assertTrue(
            current is None or current.started != started,
            f"owned helper remains after CLI return: {identity}; current={current}",
        )
        cleanup = next(
            row for row in case.journal() if row["kind"] == "containment-cleanup"
        )
        self.assertTrue(cleanup["proven"])
        self.assertIn(identity["identity"], cleanup["adopted"])
        samples = [row for row in case.journal() if row["kind"] == "sample"]
        self.assertFalse(any(identity["identity"] in row["owned"] for row in samples))
        print(
            json.dumps(
                {
                    "test": self.id(),
                    "helperReaped": True,
                    "cleanup": cleanup,
                    "receipt": case.json("receipt.json"),
                    "finalizedSidecar": (case.root / "telemetry/quiet-host.json").exists(),
                    "helperCpuAttributed": False,
                }
            ),
            flush=True,
        )

    def assert_incomplete(self, case):
        self.assertEqual(case.json("receipt.json")["status"], "incomplete")
        self.assertFalse((case.root / "telemetry/quiet-host.json").exists())
        self.assertFalse((case.root / "report.json").exists())

    def test_adapter_timeout_reaps_same_group_helper(self):
        case = self.fixture()
        command = case.command()
        case.adapter.write_text(
            self.source(case, "time.sleep(30)", "None") + fixtures.ADAPTER
        )
        process, identity = self.run_cli(case, command)
        self.assertEqual(process.returncode, 1)
        self.assert_incomplete(case)
        self.assertEqual(identity["parentPid"], identity["group"])
        self.assert_reaped(case, identity)

    def test_native_probe_pipe_timeout_reaps_helper(self):
        case = self.fixture()
        command = case.command()
        executable = case.root / "probe"
        executable.write_text(
            f"#!{sys.executable}\n" + self.source(case, "sys.exit(7)", "None")
        )
        executable.chmod(0o700)
        command[command.index("--") + 1 :] = [
            str(executable),
            str(case.root / "paired-native.ts"),
            "--out",
            str(case.root),
            "--selection-index",
            "0",
            "--launch-id",
            "owned-probe-fixture",
            "--capture-plan",
            str(case.root / "plan.json"),
        ]
        command[command.index("--report") + 1] = str(case.root / "paired-native.json")
        command[2:2] = ["--kind", "native", "--evidence-root", str(case.root)]
        process, identity = self.run_cli(case, command)
        self.assertEqual(process.returncode, 1)
        self.assert_incomplete(case)
        self.assertFalse((case.root / "paired-native.json").exists())
        self.assertTrue(
            any(row["kind"] == "native-preparation-error" for row in case.journal())
        )
        self.assert_reaped(case, identity)

    def test_successful_adapter_exit_keeps_helper_competing_and_reaps_it(self):
        case = self.fixture()
        command = case.command()
        case.adapter.write_text(
            self.source(case, "pass", "subprocess.DEVNULL") + fixtures.ADAPTER
        )
        process, identity = self.run_cli(case, command)
        self.assertEqual(process.returncode, 0)
        self.assertEqual(case.json("receipt.json")["status"], "bound")
        self.assertTrue(case.json("receipt.json")["cleanup"])
        samples = [row for row in case.journal() if row["kind"] == "sample"]
        self.assertTrue(
            any(
                any(
                    p["pid"] == identity["identity"][0]
                    for p in row["counters"]["processes"]
                )
                for row in samples
            )
        )
        self.assert_reaped(case, identity)

    def test_prelaunch_interruption_reaps_adapter_helper(self):
        case = self.fixture()
        command = case.command()
        case.adapter.write_text(
            self.source(
                case,
                "signal.pidfd_send_signal(parent_fd, signal.SIGTERM); time.sleep(30)",
                "None",
            )
        )
        process, identity = self.run_cli(case, command)
        self.assertEqual(process.returncode, 143)
        self.assert_incomplete(case)
        self.assert_reaped(case, identity)


if __name__ == "__main__":
    unittest.main()
