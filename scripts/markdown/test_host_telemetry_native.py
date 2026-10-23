"""Actual Bun launch controls for explicit native telemetry binding."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

CLI = Path(__file__).with_name("host-telemetry.py")
BUN = shutil.which("bun")
ADAPTER = """
import json, sys
from datetime import datetime, timezone
print(json.dumps(dict(observedAt=datetime.now(timezone.utc).isoformat(),
                     ownerBusy=len(sys.argv) > 1, acPower=True, runningJobs=[])))
"""
CAPTURE = """
import { cpus, hostname } from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const args = process.argv.slice(2);
const flag = (name) => args[args.indexOf(name) + 1];
const mode = flag('--fixture-mode');
const startedAt = new Date().toISOString();
const interval = async () => {
  const start = new Date().toISOString();
  const clock = performance.now();
  await new Promise(resolve => setTimeout(resolve, 150));
  return {startedAt:start, finishedAt:new Date().toISOString(),
          durationMs:performance.now() - clock};
};
const initialization = await interval();
const launchPreparation = await interval();
await new Promise(resolve => setTimeout(resolve, 450));
const output = flag('--out');
await mkdir(output);
const bytes = await readFile(flag('--capture-plan'));
const report = {schemaVersion:2, scope:'paired-native-source', mode:'qualification',
  shard:{workload:'fixture', pair:0, index:Number(flag('--selection-index')),
         planSha256:createHash('sha256').update(bytes).digest('hex'),
         launchId:flag('--launch-id')},
  metadata:{startedAt, finishedAt:new Date().toISOString(), initialization,
    launchPreparation, host:hostname(), hardware:cpus()[0].model,
    platform:process.platform, architecture:process.arch,
    runtime:`${process.release.name} ${process.version}`},
  workloads:[{id:'fixture', observedPairs:1}], pairsArtifact:{recordCount:1}};
if (mode === 'warmup') {report.shard.pair = -1; report.workloads[0].observedPairs = 0;}
if (mode === 'browser') { delete report.metadata; report.host = {}; }
if (mode === 'schema') report.schemaVersion = 1;
if (mode === 'runtime') report.metadata.runtime = 'invented runtime';
if (mode === 'host') report.metadata.host = 'another-host';
if (mode === 'interval') report.metadata.startedAt = '2020-01-01T00:00:00Z';
if (mode === 'preparation') report.metadata.launchPreparation.finishedAt = '2030-01-01T00:00:00Z';
if (mode === 'missing-initialization') delete report.metadata.initialization;
if (mode === 'launch') report.shard.launchId = 'another-launch';
if (mode === 'plan') report.shard.planSha256 = '0'.repeat(64);
if (mode === 'multiple') report.workloads[0].observedPairs = 2;
if (mode === 'null') report.metadata = null;
if (mode === 'hang') await new Promise(resolve => setTimeout(resolve, 60000));
await writeFile(path.join(output, 'paired-native.json'), JSON.stringify(report));
if (mode === 'changed-plan') await writeFile(flag('--capture-plan'), '{}');
"""


@unittest.skipUnless(
    BUN and sys.platform in ("linux", "darwin"),
    "Native launch controls require Bun and Linux or macOS",
)
class NativeTelemetryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="native-host-telemetry-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.adapter = self.root / "adapter.py"
        self.adapter.write_text(ADAPTER)
        self.config = self.root / "adapter.json"
        self.config.write_text(
            json.dumps({"command": [sys.executable, str(self.adapter)]})
        )
        self.script = self.root / "paired-native.ts"
        self.script.write_text(CAPTURE)
        self.plan = self.root / "plan.json"
        self.plan.write_text('{"fixture":"external collector control"}')
        self.report = self.root / "shards" / "0" / "paired-native.json"
        self.report.parent.parent.mkdir()
        self.out = self.root / "telemetry" / "0"
        self.env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
        self.executable = subprocess.run(
            [BUN, "-e", "console.log(process.execPath)"],
            env=self.env,
            capture_output=True,
            text=True,
            timeout=3,
            check=True,
        ).stdout.strip()

    def command(self, mode="ok"):
        return [
            sys.executable,
            str(CLI),
            "--kind",
            "native",
            "--evidence-root",
            str(self.root),
            "--out",
            str(self.out),
            "--report",
            str(self.report),
            "--adapter-config",
            str(self.config),
            "--timeout-seconds",
            "5",
            "--interval-seconds",
            "0.1",
            "--",
            BUN,
            str(self.script),
            "--capture-plan",
            str(self.plan),
            "--selection-index",
            "0",
            "--launch-id",
            "external-fixture-0",
            "--out",
            str(self.report.parent),
            "--fixture-mode",
            mode,
        ]

    def run_capture(self, mode="ok"):
        return subprocess.run(
            self.command(mode),
            env=self.env,
            capture_output=True,
            text=True,
            timeout=12,
            check=False,
        )

    def artifact(self, name):
        return json.loads((self.out / name).read_text())

    def test_native_mode_binds_actual_runtime_argv_report_and_samples(self):
        result = self.run_capture()
        self.assertEqual(result.returncode, 0, result.stderr)
        artifact = self.artifact("quiet-host.json")
        invocation = artifact["nativeInvocation"]
        self.assertEqual(
            set(invocation),
            {"executablePath", "argv", "runtime", "reportPath", "environment"},
        )
        self.assertEqual(invocation["argv"], [self.executable] + self.command()[18:])
        self.assertEqual(invocation["executablePath"], self.executable)
        report = json.loads(self.report.read_text())
        self.assertEqual(invocation["runtime"], report["metadata"]["runtime"])
        self.assertEqual(invocation["reportPath"], "shards/0/paired-native.json")
        self.assertEqual(
            invocation["environment"],
            {name: self.env.get(name) for name in ("NODE_OPTIONS", "BUN_OPTIONS")},
        )
        self.assertEqual(
            artifact["reportSha256"],
            hashlib.sha256(self.report.read_bytes()).hexdigest(),
        )
        self.assertEqual(self.artifact("receipt.json")["status"], "bound")
        journal = [
            json.loads(line)
            for line in (self.out / "observations.jsonl").read_text().splitlines()
        ]
        self.assertTrue(any(row["kind"] == "native-runtime" for row in journal))
        self.assertTrue(any(row["kind"] == "launch" for row in journal))
        self.assertTrue(self.artifact("host.json")["host"])

    def test_native_original_warmup_keeps_zero_measured_pairs(self):
        result = self.run_capture("warmup")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.artifact("receipt.json")["status"], "bound")
        report = json.loads(self.report.read_text())
        self.assertEqual(report["shard"]["pair"], -1)
        self.assertEqual(report["workloads"][0]["observedPairs"], 0)
        self.assertEqual(report["pairsArtifact"]["recordCount"], 1)

    def test_native_validation_preserves_rejected_original_reports(self):
        for mode in (
            "browser",
            "schema",
            "runtime",
            "host",
            "interval",
            "preparation",
            "missing-initialization",
            "launch",
            "plan",
            "multiple",
            "changed-plan",
            "null",
        ):
            with self.subTest(mode=mode):
                self.check_rejection(mode)

    def check_rejection(self, mode):
        result = self.run_capture(mode)
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(self.report.is_file(), result.stderr)
        self.assertFalse((self.out / "quiet-host.json").exists())
        self.assertEqual(self.artifact("receipt.json")["status"], "incomplete")
        self.assertTrue((self.out / "observations.jsonl").is_file())
        shutil.rmtree(self.out)
        shutil.rmtree(self.report.parent)
        self.plan.write_text('{"fixture":"external collector control"}')

    def test_native_busy_and_instrumentation_environment_remain_observed(self):
        self.config.write_text(
            json.dumps({"command": [sys.executable, str(self.adapter), "busy"]})
        )
        self.env["NODE_OPTIONS"] = "--no-warnings"
        result = self.run_capture()
        self.assertEqual(result.returncode, 0, result.stderr)
        artifact = self.artifact("quiet-host.json")
        self.assertTrue(all(row["ownerBusy"] for row in artifact["observations"]))
        self.assertEqual(
            artifact["nativeInvocation"]["environment"]["NODE_OPTIONS"], "--no-warnings"
        )

    def test_native_runtime_observation_failure_retains_raw_probe(self):
        command = self.command()
        command[17] = sys.executable
        result = subprocess.run(
            command,
            env=self.env,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.report.exists())
        self.assertFalse(self.artifact("receipt.json")["launched"])
        rows = [
            json.loads(line)
            for line in (self.out / "observations.jsonl").read_text().splitlines()
        ]
        probe = next(row for row in rows if row["kind"] == "native-runtime")
        self.assertNotEqual(probe["exitCode"], 0)
        self.assertTrue(probe["stderr"])

    def test_native_timeout_keeps_invocation_and_after_observations(self):
        command = self.command("hang")
        command[command.index("--timeout-seconds") + 1] = "1"
        result = subprocess.run(
            command,
            env=self.env,
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        self.assertEqual(result.returncode, 124, result.stderr)
        self.assertEqual(self.artifact("receipt.json")["reason"], "timeout")
        self.assertTrue(self.artifact("receipt.json")["cleanup"])
        rows = [
            json.loads(line)
            for line in (self.out / "observations.jsonl").read_text().splitlines()
        ]
        self.assertTrue(any(row["kind"] == "native-invocation" for row in rows))
        self.assertTrue(any(row.get("phase") == "after" for row in rows))
        self.assertFalse((self.out / "quiet-host.json").exists())

    def test_native_refuses_report_outside_evidence_root_before_launch(self):
        command = self.command()
        command[5] = str(self.out)
        result = subprocess.run(
            command,
            env=self.env,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.report.exists())
        self.assertFalse(self.artifact("receipt.json")["launched"])

    def test_native_refuses_indirect_producer_before_launch(self):
        command = self.command()
        command[18] = "run"
        result = subprocess.run(
            command,
            env=self.env,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.report.exists())
        self.assertFalse(self.artifact("receipt.json")["launched"])

    def test_native_requires_explicit_root_and_direct_producer(self):
        command = self.command()
        del command[4:6]
        result = subprocess.run(
            command,
            env=self.env,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.report.exists())


if __name__ == "__main__":
    unittest.main()
