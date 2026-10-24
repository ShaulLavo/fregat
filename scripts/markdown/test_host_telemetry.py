"""Real OS and external-adapter controls for the host telemetry CLI."""

from __future__ import annotations

import hashlib
import json
import os
import selectors
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from host_telemetry import Collector
from host_telemetry_os import cpu_interval, host_identity, snapshot

CLI = Path(__file__).with_name("host-telemetry.py")

ADAPTER = """
import json, sys
from pathlib import Path
from datetime import datetime, timezone
mode = sys.argv[1]
if mode == "failed":
    sys.exit(7)
value = dict(observedAt=datetime.now(timezone.utc).isoformat(),
             ownerBusy=mode == "busy", acPower=mode != "battery", runningJobs=[])
if mode == "unknown" or (mode == "changing" and Path(sys.argv[2]).exists()):
    value["ownerBusy"] = None
if mode == "stale":
    value["observedAt"] = "2020-01-01T00:00:00Z"
if mode == "job":
    value["runningJobs"] = ["unrelated-fixture-job"]
print(json.dumps(value))
"""

CAPTURE = """
import hashlib, json, pathlib, sys, time, subprocess, os
from datetime import datetime, timezone
from host_telemetry_os import host_identity
stamp = lambda: datetime.now(timezone.utc).isoformat()
report, host_file, mode = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
if mode == "absent-output":
    report.parent.mkdir(parents=True, exist_ok=False)
before = stamp()
if mode in ("hang", "detached"):
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"],
                             start_new_session=mode == "detached")
    report.with_suffix(".pid").write_text(str(child.pid))
    print("ready", flush=True)
    time.sleep(60)
if mode == "policy-failure":
    report.with_suffix(".adapter-fail").touch()
if mode == "nonzero":
    sys.exit(9)
time.sleep(0.65)
identity = host_identity()
identity["id"] = identity.pop("host")
identity.update(before=dict(observedAt=before), after=dict(observedAt=stamp()))
value = dict(host=identity, capture=dict(hostEvidence=dict(
    sha256=hashlib.sha256(host_file.read_bytes()).hexdigest(),
    observation=json.loads(host_file.read_text()))))
if mode == "wrong-host":
    value["host"]["id"] = "another-host"
if mode == "wrong-binding":
    value["capture"]["hostEvidence"]["sha256"] = "0" * 64
report.write_text(json.dumps(value))
"""


@unittest.skipUnless(
    sys.platform in ("linux", "darwin"), "Native telemetry requires Linux or macOS"
)
class TelemetryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="host-telemetry-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.adapter = self.root / "adapter.py"
        self.adapter.write_text(ADAPTER)
        self.capture = self.root / "capture.py"
        self.capture.write_text(CAPTURE)
        self.config = self.root / "adapter.json"
        self.env = dict(
            os.environ,
            PYTHONDONTWRITEBYTECODE="1",
            PYTHONPATH=str(CLI.parent.resolve()),
        )

    def command(self, policy="ok", mode="ok", timeout=4):
        self.config.write_text(
            json.dumps(
                {
                    "command": [
                        sys.executable,
                        str(self.adapter),
                        policy,
                        str(self.root / "report.adapter-fail"),
                    ]
                }
            )
        )
        return [
            sys.executable,
            str(CLI),
            "--out",
            str(self.root / "telemetry"),
            "--report",
            str(self.root / "report.json"),
            "--adapter-config",
            str(self.config),
            "--timeout-seconds",
            str(timeout),
            "--interval-seconds",
            "0.15",
            "--",
            sys.executable,
            str(self.capture),
            str(self.root / "report.json"),
            "{hostEvidence}",
            mode,
        ]

    def run_capture(self, **options):
        return subprocess.run(
            self.command(**options),
            env=self.env,
            capture_output=True,
            text=True,
            check=False,
            timeout=12,
        )

    def json(self, name):
        return json.loads((self.root / "telemetry" / name).read_text())

    def journal(self):
        return [
            json.loads(line)
            for line in (self.root / "telemetry" / "observations.jsonl")
            .read_text()
            .splitlines()
        ]

    def test_capture_interruption_escapes_os_error_handlers(self):
        out = self.root / "interruption"
        out.mkdir()
        collector = Collector(out, [])
        self.addCleanup(collector.close)
        with self.assertRaises(Exception) as interrupted:
            collector.interrupt(signal.SIGTERM, None)
        self.assertNotIsInstance(interrupted.exception, OSError)
        self.assertEqual(str(interrupted.exception), "Capture received signal 15")

    def test_native_observer_sees_real_process_identity_and_cpu(self):
        before = snapshot()
        own = next(
            process for process in before.processes if process.pid == os.getpid()
        )
        deadline = time.monotonic() + 0.12
        while time.monotonic() < deadline:
            hashlib.sha256(b"counter-control" * 100).digest()
        after = snapshot()
        current = next(
            process for process in after.processes if process.pid == os.getpid()
        )
        self.assertEqual(current.identity, own.identity)
        self.assertGreater(current.cpu_ns, own.cpu_ns)
        interval = cpu_interval(before, after, {own.identity})
        self.assertGreater(interval["capacityNs"], 0)
        self.assertGreaterEqual(interval["competingCpuPercent"], 0)
        self.assertEqual(host_identity()["host"], os.uname().nodename)

    def cpu_control(self):
        code = """
import sys, time
print("ready", flush=True)
seconds = float(sys.stdin.readline())
end = time.process_time() + seconds
while time.process_time() < end:
    pass
print("finished", flush=True)
sys.stdin.readline()
"""
        return subprocess.Popen(
            [sys.executable, "-c", code],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            start_new_session=True,
        )

    def control_message(self, process, expected):
        with selectors.DefaultSelector() as ready:
            ready.register(process.stdout, selectors.EVENT_READ)
            self.assertTrue(ready.select(timeout=30), "CPU control readiness")
            self.assertEqual(process.stdout.readline().strip(), expected)

    def test_unowned_cpu_remains_competing_and_owned_cpu_is_a_lower_bound(self):
        owned, other = self.cpu_control(), self.cpu_control()
        try:
            self.control_message(owned, "ready")
            self.control_message(other, "ready")
            before = snapshot()
            identity = next(p.identity for p in before.processes if p.pid == owned.pid)
            scan_capacity = (
                (before.monotonic_ns - before.cpu_started_ns)
                * before.logical_cpus
                / 1e9
            )
            seconds = max(2, scan_capacity * 4)
            self.assertLess(
                seconds, 30, "Observer control exceeds its bounded CPU span"
            )
            for process in (owned, other):
                process.stdin.write(f"{seconds}\n")
                process.stdin.flush()
            self.control_message(owned, "finished")
            self.control_message(other, "finished")
            after = snapshot()
            attributed = cpu_interval(before, after, {identity})
            all_competing = cpu_interval(before, after, set())
            self.assertGreater(attributed["ownedCpuNs"], 0, str(attributed))
            self.assertLess(
                attributed["competingCpuPercent"], all_competing["competingCpuPercent"]
            )
            competitor = next(p for p in after.processes if p.pid == other.pid)
            prior = next(
                p for p in before.processes if p.identity == competitor.identity
            )
            self.assertGreater(competitor.cpu_ns, prior.cpu_ns)
            self.assertNotIn(competitor.identity, {identity})
        finally:
            owned.kill()
            other.kill()
            owned.wait(timeout=2)
            other.wait(timeout=2)
            for process in (owned, other):
                process.stdin.close()
                process.stdout.close()
        self.assertFalse(
            any(
                p.pid in (owned.pid, other.pid) and p.live for p in snapshot().processes
            )
        )

    def test_cli_binds_original_report_bytes_and_preserves_actual_samples(self):
        result = self.run_capture()
        self.assertEqual(result.returncode, 0, result.stderr)
        artifact = self.json("quiet-host.json")
        raw = (self.root / "report.json").read_bytes()
        self.assertEqual(artifact["reportSha256"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(artifact["host"], host_identity()["host"])
        samples = [row for row in self.journal() if row["kind"] == "sample"]
        self.assertEqual(
            artifact["observations"], [row["observation"] for row in samples]
        )
        self.assertEqual(
            {row["phase"] for row in samples}, {"before", "during", "after"}
        )
        self.assertTrue(all(row["counters"]["processes"] for row in samples))
        self.assertTrue(self.json("receipt.json")["cleanup"])
        self.assertEqual(set(self.json("host.json")), {"host", "observedAt"})
        self.assertEqual(
            set(artifact),
            {
                "host",
                "platform",
                "architecture",
                "hardware",
                "osRelease",
                "memoryBytes",
                "reportSha256",
                "observations",
            },
        )

    def test_sibling_layout_leaves_capture_output_absent_until_launch(self):
        command = self.command(mode="absent-output")
        telemetry = self.root / "telemetry" / "0"
        report = self.root / "shards" / "0" / "production-browser.json"
        command[command.index("--out") + 1] = str(telemetry)
        command[command.index("--report") + 1] = str(report)
        command[command.index(str(self.capture)) + 1] = str(report)
        result = subprocess.run(
            command,
            env=self.env,
            capture_output=True,
            text=True,
            check=False,
            timeout=12,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        artifact = json.loads((telemetry / "quiet-host.json").read_text())
        self.assertEqual(
            artifact["reportSha256"], hashlib.sha256(report.read_bytes()).hexdigest()
        )
        self.assertEqual(
            (report.parent / "../../telemetry/0/host.json").resolve(),
            telemetry / "host.json",
        )

    def test_busy_is_preserved_without_a_quiet_verdict(self):
        result = self.run_capture(policy="busy")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(
            all(
                row["ownerBusy"] for row in self.json("quiet-host.json")["observations"]
            )
        )

    def test_battery_is_preserved(self):
        result = self.run_capture(policy="battery")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(
            all(
                not row["acPower"]
                for row in self.json("quiet-host.json")["observations"]
            )
        )

    def test_unrelated_jobs_are_preserved(self):
        result = self.run_capture(policy="job")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(
            all(
                row["runningJobs"] == ["unrelated-fixture-job"]
                for row in self.json("quiet-host.json")["observations"]
            )
        )

    def test_during_and_after_adapter_failures_block_finalization(self):
        result = self.run_capture(policy="changing", mode="policy-failure")
        self.assertEqual(result.returncode, 1, result.stderr)
        errors = [row for row in self.journal() if row["kind"] == "error"]
        self.assertIn("during", [row["phase"] for row in errors])
        self.assertIn("after", [row["phase"] for row in errors])
        self.assertFalse((self.root / "telemetry" / "quiet-host.json").exists())

    def test_spawn_error_preserves_receipt_and_observations(self):
        command = self.command()
        command[command.index("--") + 1] = str(self.root / "absent-binary")
        result = subprocess.run(
            command, env=self.env, capture_output=True, check=False, timeout=12
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.json("receipt.json")["errorType"], "FileNotFoundError")
        self.assertTrue(any(row.get("phase") == "after" for row in self.journal()))

    def test_unknown_policy_blocks_launch_and_keeps_errors(self):
        result = self.run_capture(policy="unknown")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / "report.json").exists())
        self.assertFalse((self.root / "telemetry" / "quiet-host.json").exists())
        self.assertFalse(self.json("receipt.json")["launched"])
        self.assertEqual(
            [row["kind"] for row in self.journal()],
            ["error", "error", "containment-cleanup"],
        )
        self.assertTrue(self.journal()[-1]["proven"])
        self.assertEqual(self.journal()[-1]["adopted"], [])

    def test_stale_adapter_timestamp_blocks_launch(self):
        result = self.run_capture(policy="stale")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("during this invocation", self.journal()[0]["message"])

    def test_adapter_exit_is_preserved(self):
        result = self.run_capture(policy="failed")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("exited 7", self.journal()[0]["message"])

    def test_report_host_mismatch_blocks_finalization(self):
        result = self.run_capture(mode="wrong-host")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn(
            "identity differs",
            self.json("receipt.json")["finalizationError"]["message"],
        )
        self.assertFalse((self.root / "telemetry" / "quiet-host.json").exists())

    def test_report_binding_mismatch_blocks_finalization(self):
        result = self.run_capture(mode="wrong-binding")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn(
            "prelaunch", self.json("receipt.json")["finalizationError"]["message"]
        )

    def test_failed_command_preserves_exit_and_after_observation(self):
        result = self.run_capture(mode="nonzero")
        self.assertEqual(result.returncode, 9, result.stderr)
        self.assertTrue(any(row.get("phase") == "after" for row in self.journal()))
        self.assertEqual(self.json("receipt.json")["exitCode"], 9)

    def test_timeout_stops_actual_descendant_and_records_after(self):
        result = self.run_capture(mode="hang", timeout=0.7)
        self.assertEqual(result.returncode, 124, result.stderr)
        self.assertEqual(self.json("receipt.json")["reason"], "timeout")
        descendant = int((self.root / "report.pid").read_text())
        self.assertFalse(
            any(p.pid == descendant and p.live for p in snapshot().processes)
        )
        self.assertTrue(any(row.get("phase") == "after" for row in self.journal()))

    def test_timeout_stops_observed_descendant_in_a_separate_process_group(self):
        result = self.run_capture(mode="detached", timeout=0.7)
        self.assertEqual(result.returncode, 124, result.stderr)
        descendant = int((self.root / "report.pid").read_text())
        self.assertFalse(
            any(p.pid == descendant and p.live for p in snapshot().processes)
        )
        self.assertTrue(self.json("receipt.json")["cleanup"])

    def test_sigterm_stops_owned_command_and_records_failure(self):
        process = subprocess.Popen(
            self.command(mode="hang"),
            env=self.env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.addCleanup(lambda: process.kill() if process.poll() is None else None)
        with selectors.DefaultSelector() as ready:
            ready.register(process.stdout, selectors.EVENT_READ)
            self.assertTrue(ready.select(timeout=4), "capture readiness")
            self.assertEqual(process.stdout.readline().strip(), "ready")
        process.send_signal(signal.SIGTERM)
        _, stderr = process.communicate(timeout=6)
        self.assertEqual(process.returncode, 143, stderr)
        self.assertEqual(self.json("receipt.json")["reason"], "interrupted")
        descendant = int((self.root / "report.pid").read_text())
        self.assertFalse(
            any(p.pid == descendant and p.live for p in snapshot().processes)
        )


if __name__ == "__main__":
    unittest.main()
