"""Bind one directly executed native producer to its actual runtime and report."""

from __future__ import annotations

import hashlib
import json
import math
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from host_telemetry import timestamp

RUNTIME_PROBE = """
console.log(JSON.stringify({executablePath:process.execPath,
  runtime:`${process.release.name} ${process.version}`,
  host:require('node:os').hostname(), hardware:require('node:os').cpus()[0].model,
  platform:process.platform, architecture:process.arch}));
"""


def file_digest(file: Path) -> str:
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def option(command: list[str], name: str) -> str:
    matches = [index for index, arg in enumerate(command) if arg == name]
    if len(matches) != 1 or matches[0] + 1 >= len(command):
        raise ValueError(f"Native command requires exactly one {name} value")
    value = command[matches[0] + 1]
    if not value or value.startswith("--"):
        raise ValueError(f"Native command requires a nonempty {name} value")
    return value


@dataclass(frozen=True)
class NativeLaunch:
    command: list[str]
    environment: dict[str, str]
    runtime: dict
    executable_sha256: str
    plan: Path
    plan_sha256: str
    selection: int
    launch_id: str
    report_path: str

    def invocation(self) -> dict:
        return {
            "executablePath": self.command[0],
            "argv": self.command,
            "runtime": self.runtime["runtime"],
            "reportPath": self.report_path,
            "environment": {
                name: self.environment.get(name)
                for name in ("NODE_OPTIONS", "BUN_OPTIONS")
            },
        }


def runtime_probe(executable: str, environment: dict, collector) -> dict:
    command = [executable, "-e", RUNTIME_PROBE]
    child = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=environment,
        start_new_session=True,
    )
    stdout, stderr = "", ""
    try:
        stdout, stderr = child.communicate(timeout=3)
        if child.returncode:
            raise RuntimeError(f"Native runtime observation exited {child.returncode}")
        value = json.loads(stdout)
        if not isinstance(value, dict) or any(
            not isinstance(value.get(key), str) or not value[key]
            for key in (
                "executablePath",
                "runtime",
                "host",
                "hardware",
                "platform",
                "architecture",
            )
        ):
            raise ValueError("Native runtime observation is incomplete")
        return value
    finally:
        child.kill()
        stdout, stderr = child.communicate(timeout=2)
        collector.record(
            "native-runtime",
            command=command,
            stdout=stdout,
            stderr=stderr,
            exitCode=child.returncode,
        )


def prepare_native(
    command: list[str], report: Path, root: Path, collector
) -> NativeLaunch:
    if len(command) < 2 or Path(command[1]).name != "paired-native.ts":
        raise ValueError(
            "Native mode requires the runtime and direct paired-native.ts script"
        )
    resolved = shutil.which(command[0])
    if resolved is None:
        raise ValueError("Native runtime executable is unavailable")
    command = [str(Path(resolved).absolute())] + command[1:]
    if Path(option(command, "--out")).resolve() != report.parent:
        raise ValueError("Native output directory differs from the report directory")
    if report.name != "paired-native.json":
        raise ValueError("Native mode requires the original paired-native.json report")
    selection = int(option(command, "--selection-index"))
    if selection < 0:
        raise ValueError("Native selection index must be nonnegative")
    launch_id = option(command, "--launch-id")
    plan = Path(option(command, "--capture-plan")).resolve()
    report_path = report.relative_to(root.resolve()).as_posix()
    collector.out.relative_to(root.resolve())
    environment = dict(os.environ)
    runtime = runtime_probe(command[0], environment, collector)
    command[0] = str(Path(runtime["executablePath"]).resolve())
    executable_sha256 = file_digest(Path(command[0]))
    direct = runtime_probe(command[0], environment, collector)
    if direct != runtime:
        raise ValueError("Resolved native runtime differs from the runtime observation")
    for key in ("host", "platform", "architecture", "hardware"):
        if runtime[key] != collector.identity[key]:
            raise ValueError(f"Native runtime {key} differs from the observed host")
    launch = NativeLaunch(
        command,
        environment,
        runtime,
        executable_sha256,
        plan,
        file_digest(plan),
        selection,
        launch_id,
        report_path,
    )
    collector.record(
        "native-invocation",
        invocation=launch.invocation(),
        executableSha256=executable_sha256,
        planSha256=launch.plan_sha256,
    )
    return launch


def measured_interval(
    value: dict, launch: NativeLaunch, identity: dict
) -> tuple[float, float]:
    if not isinstance(value, dict):
        raise TypeError("Native report requires an object")
    if value.get("schemaVersion") != 2 or value.get("scope") != "paired-native-source":
        raise ValueError("Native mode requires a schema2 paired-native-source report")
    if value.get("mode") != "qualification":
        raise ValueError("Native mode requires a qualification-profile report")
    metadata = value["metadata"]
    for key in ("host", "hardware", "platform", "architecture", "runtime"):
        if metadata[key] != launch.runtime[key]:
            raise ValueError(f"Native report {key} differs from the observed runtime")
    if metadata["host"] != identity["host"]:
        raise ValueError("Native report host differs from the observed host")
    start, end = timestamp(metadata["startedAt"]), timestamp(metadata["finishedAt"])
    initialization = subinterval(metadata["initialization"], start, end)
    preparation = subinterval(metadata["launchPreparation"], start, end)
    if initialization[1] > preparation[0]:
        raise ValueError("Native initialization overlaps launch preparation")
    shard = value["shard"]
    if shard["index"] != launch.selection or shard["launchId"] != launch.launch_id:
        raise ValueError(
            "Native report selection or launch identity differs from executed argv"
        )
    if shard["planSha256"] != launch.plan_sha256:
        raise ValueError("Native report plan digest differs from the launched plan")
    workloads = value["workloads"]
    pair = shard["pair"]
    if type(pair) is not int or not -3 <= pair <= 19:
        raise ValueError("Native shard pair index is outside the original population")
    measured_pairs = int(pair >= 0)
    if (
        len(workloads) != 1
        or workloads[0]["observedPairs"] != measured_pairs
        or value["pairsArtifact"]["recordCount"] != 1
    ):
        raise ValueError(
            "Native telemetry binds exactly one original counted workload pair"
        )
    if workloads[0]["id"] != shard["workload"]:
        raise ValueError("Native report workload differs from its shard identity")
    if file_digest(launch.plan) != launch.plan_sha256:
        raise ValueError("Native capture plan changed during the launch")
    if file_digest(Path(launch.command[0])) != launch.executable_sha256:
        raise ValueError("Native executable changed during the launch")
    return start, end


def subinterval(value: dict, start: float, end: float) -> tuple[float, float]:
    first, last = timestamp(value["startedAt"]), timestamp(value["finishedAt"])
    duration = value["durationMs"]
    if (
        type(duration) not in (float, int)
        or not math.isfinite(duration)
        or duration < 0
    ):
        raise ValueError("Native initialization/preparation duration is unavailable")
    if not start <= first <= last <= end:
        raise ValueError(
            "Native initialization/preparation falls outside the reported launch"
        )
    return first, last
