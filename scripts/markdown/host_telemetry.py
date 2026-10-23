"""Measure one bounded process group and bind its report after exit."""

from __future__ import annotations

import hashlib
import json
import math
import os
import signal
import subprocess
import threading
import time
from datetime import datetime, timezone
from itertools import pairwise
from pathlib import Path

from host_telemetry_os import (
    capture_identities,
    command_text,
    cpu_interval,
    host_identity,
    snapshot,
)


def utc_now() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def timestamp(value: object) -> float:
    if not isinstance(value, str):
        raise TypeError("Observation timestamp must be an ISO datetime")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Observation timestamp requires a timezone")
    return parsed.timestamp()


def write_json(file: Path, value: object) -> None:
    with file.open("x") as output:
        json.dump(value, output, indent=2, allow_nan=False)
        output.write("\n")


def adapter_config(file: Path) -> list[str]:
    raw = json.loads(file.read_text())
    command = raw.get("command") if isinstance(raw, dict) else None
    if not isinstance(command, list) or not command:
        raise ValueError("Adapter config requires a command array")
    if any(not isinstance(arg, str) or not arg for arg in command):
        raise ValueError("Adapter command arguments must be nonempty strings")
    return command


def observe_policy(command: list[str], context: dict) -> dict:
    started = time.time()
    raw = json.loads(run_adapter(command, context))
    if not isinstance(raw, dict):
        raise TypeError("Policy adapter requires an observation object")
    observed = timestamp(raw.get("observedAt"))
    if not started - 0.001 <= observed <= time.time():
        raise ValueError(
            "Policy adapter observation must be taken during this invocation"
        )
    if type(raw.get("ownerBusy")) is not bool or type(raw.get("acPower")) is not bool:
        raise ValueError(
            "Policy adapter must observe ownerBusy and acPower as booleans"
        )
    jobs = raw.get("runningJobs")
    if not isinstance(jobs, list) or any(
        not isinstance(job, str) or not job for job in jobs
    ):
        raise ValueError("Policy adapter must observe runningJobs as a string array")
    return raw


def run_adapter(command: list[str], context: dict) -> str:
    child = subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    try:
        stdout, stderr = child.communicate(json.dumps(context), timeout=1)
        if child.returncode != 0:
            raise RuntimeError(
                f"Policy adapter exited {child.returncode}: {stderr[:4096]}"
            )
        return stdout
    finally:
        terminate_group(child.pid)
        kill_group(child.pid)
        child.wait(timeout=2)


class Collector:
    def __init__(self, out: Path, adapter: list[str]):
        self.out, self.adapter = out, adapter
        self.identity = host_identity()
        self.observations: list[dict] = []
        self.failures: list[dict] = []
        self.previous = None
        self.group = None
        self.owned: set[tuple[int, int]] = set()
        self.capture_owned: set[tuple[int, int]] = set()
        self.stop = threading.Event()
        self.thread = None
        self.journal = (out / "observations.jsonl").open("x", buffering=1)
        self.own_pid = os.getpid()

    def record(self, kind: str, **fields) -> None:
        self.journal.write(
            json.dumps(dict(kind=kind, recordedAt=utc_now(), **fields), allow_nan=False)
            + "\n"
        )
        self.journal.flush()
        os.fsync(self.journal.fileno())

    def sample(self, phase: str) -> None:
        try:
            self.observe(phase)
        except (
            OSError,
            ValueError,
            TypeError,
            KeyError,
            RuntimeError,
            subprocess.SubprocessError,
        ) as error:
            failure = {
                "phase": phase,
                "observedAt": utc_now(),
                "errorType": type(error).__name__,
                "message": str(error),
            }
            self.failures.append(failure)
            self.record("error", **failure)

    def observe(self, phase: str) -> None:
        policy = observe_policy(
            self.adapter,
            {
                "collectorPid": self.own_pid,
                "captureProcessGroup": self.group,
                "phase": phase,
            },
        )
        current = snapshot()
        self.capture_owned.update(
            capture_identities(current, self.group, self.capture_owned)
        )
        self.owned.update(self.capture_owned)
        self.owned.update(
            process.identity
            for process in current.processes
            if process.pid == self.own_pid
        )
        if self.own_pid in current.unreadable_pids:
            raise RuntimeError("Collector process counters are unavailable")
        previous, self.previous = self.previous, current
        if previous is None:
            self.record(
                "baseline", phase=phase, policy=policy, counters=current.record()
            )
            return
        interval = cpu_interval(previous, current, self.owned)
        observation = {
            "observedAt": utc_now(),
            "logicalCpus": current.logical_cpus,
            "loadAverage": current.load_average,
            "ownerBusy": policy["ownerBusy"],
            "acPower": policy["acPower"],
            "runningJobs": policy["runningJobs"],
            "competingCpuPercent": interval["competingCpuPercent"],
        }
        if current.logical_cpus <= 0 or any(
            not math.isfinite(x) or x < 0 for x in current.load_average
        ):
            raise RuntimeError("Native CPU count or load average is unavailable")
        self.observations.append(observation)
        self.record(
            "sample",
            phase=phase,
            observation=observation,
            policy=policy,
            interval=interval,
            counters=current.record(),
            owned=sorted(self.owned),
        )

    def monitor(self, interval: float) -> None:
        while not self.stop.wait(interval):
            self.sample("during")

    def start(self, group: int, interval: float) -> None:
        self.group = group
        self.thread = threading.Thread(
            target=self.monitor, args=(interval,), daemon=True
        )
        self.thread.start()

    def finish(self) -> None:
        self.stop.set()
        if self.thread is not None:
            self.thread.join()
        self.sample("after")

    def interrupt(self, signum, _frame) -> None:
        raise InterruptedError(f"Capture received signal {signum}")

    def close(self) -> None:
        self.journal.close()


def validate_coverage(observations: list[dict], start: float, end: float) -> None:
    times = [timestamp(entry["observedAt"]) for entry in observations]
    if len(times) < 3 or not times[0] < start < end < times[-1]:
        raise ValueError("Telemetry must bracket the complete reported run")
    if not any(start < observed < end for observed in times):
        raise ValueError("Telemetry requires an observation during the reported run")
    if any(not 0 < later - earlier <= 5 for earlier, later in pairwise(times)):
        raise ValueError("Telemetry gaps must advance by at most five seconds")


def finalize(
    collector: Collector, report: Path, host_file: Path, launched: float, exited: float
) -> dict:
    if collector.failures:
        raise ValueError("Observation failures prevent telemetry finalization")
    raw = report.read_bytes()
    value = json.loads(raw)
    host = value["host"]
    if host["id"] != collector.identity["host"]:
        raise ValueError("Report host identity differs from the observed host")
    for key in ("platform", "architecture", "hardware", "osRelease", "memoryBytes"):
        if host[key] != collector.identity[key]:
            raise ValueError(f"Report host {key} differs from the observed host")
    start, end = (
        timestamp(host["before"]["observedAt"]),
        timestamp(host["after"]["observedAt"]),
    )
    if not launched <= start < end <= exited:
        raise ValueError("Reported run timestamps fall outside the owned launch")
    evidence = value["capture"]["hostEvidence"]
    if evidence != {
        "sha256": hashlib.sha256(host_file.read_bytes()).hexdigest(),
        "observation": json.loads(host_file.read_text()),
    }:
        raise ValueError(
            "Report prelaunch host evidence differs from the collector artifact"
        )
    validate_coverage(collector.observations, start, end)
    artifact = dict(
        **collector.identity,
        reportSha256=hashlib.sha256(raw).hexdigest(),
        observations=collector.observations,
    )
    write_json(collector.out / "quiet-host.json", artifact)
    return {
        "reportSha256": artifact["reportSha256"],
        "observations": len(collector.observations),
    }


def terminate_group(group: int) -> None:
    try:
        os.killpg(group, signal.SIGTERM)
    except ProcessLookupError:
        return


def kill_group(group: int) -> None:
    try:
        os.killpg(group, signal.SIGKILL)
    except ProcessLookupError:
        return


def run_capture(args) -> int:
    out, report = args.out.resolve(), args.report.resolve()
    if report.exists():
        raise ValueError("Report destination must be absent before launch")
    if "{hostEvidence}" not in args.command:
        raise ValueError("Command must include the literal {hostEvidence} argument")
    command = adapter_config(args.adapter_config)
    out.mkdir(parents=True, exist_ok=False)
    try:
        collector = Collector(out, command)
    except (
        OSError,
        ValueError,
        TypeError,
        KeyError,
        RuntimeError,
        subprocess.SubprocessError,
    ) as error:
        write_json(
            out / "receipt.json",
            {
                "status": "incomplete",
                "launched": False,
                "errorType": type(error).__name__,
                "message": str(error),
            },
        )
        return 1
    previous_handlers = {}
    try:
        for signum in (signal.SIGINT, signal.SIGTERM):
            previous_handlers[signum] = signal.signal(signum, collector.interrupt)
        return execute_capture(args, collector, report)
    except InterruptedError as error:
        collector.record(
            "interrupted", errorType=type(error).__name__, message=str(error)
        )
        write_json(
            out / "receipt.json",
            {
                "status": "incomplete",
                "launched": collector.group is not None,
                "errorType": type(error).__name__,
                "message": str(error),
            },
        )
        return 143
    finally:
        collector.stop.set()
        if collector.thread is not None:
            collector.thread.join()
        collector.close()
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)


def execute_capture(args, collector: Collector, report: Path) -> int:
    collector.sample("before")
    time.sleep(0.2)
    collector.sample("before")
    if collector.failures or not collector.observations:
        write_json(
            collector.out / "receipt.json",
            {"status": "incomplete", "launched": False, "failures": collector.failures},
        )
        return 1
    host_file = collector.out / "host.json"
    write_json(host_file, {"host": collector.identity["host"], "observedAt": utc_now()})
    command = [
        str(host_file) if arg == "{hostEvidence}" else arg for arg in args.command
    ]
    try:
        status, reason, launched, exited, cleanup = launch_capture(
            args, collector, command
        )
    except (
        OSError,
        ValueError,
        TypeError,
        KeyError,
        RuntimeError,
        subprocess.SubprocessError,
    ) as error:
        collector.finish()
        collector.record(
            "launch-error", errorType=type(error).__name__, message=str(error)
        )
        write_json(
            collector.out / "receipt.json",
            {
                "status": "incomplete",
                "launched": collector.group is not None,
                "errorType": type(error).__name__,
                "message": str(error),
            },
        )
        return 1
    collector.record("exit", exitCode=status, reason=reason, cleanup=cleanup)
    receipt = {
        "status": "incomplete",
        "exitCode": status,
        "reason": reason,
        "cleanup": cleanup,
    }
    try:
        if not cleanup or reason != "exited":
            raise ValueError("Interrupted or unclean launch prevents finalization")
        receipt.update(
            finalize(collector, report, host_file, launched, exited), status="bound"
        )
    except (
        OSError,
        ValueError,
        TypeError,
        KeyError,
        RuntimeError,
        subprocess.SubprocessError,
    ) as error:
        receipt["finalizationError"] = {
            "errorType": type(error).__name__,
            "message": str(error),
        }
    write_json(collector.out / "receipt.json", receipt)
    return 128 - status if status < 0 else (status or int(receipt["status"] != "bound"))


def launch_capture(args, collector, command) -> tuple:
    launched = time.time()
    child = subprocess.Popen(command, start_new_session=True)
    try:
        collector.group = child.pid
        collector.record(
            "launch",
            pid=child.pid,
            processGroup=child.pid,
            launchedAt=utc_now(),
            command=command,
        )
        collector.start(child.pid, args.interval_seconds)
        status, reason = wait_child(child, args.timeout_seconds)
    finally:
        terminate_group(child.pid)
        kill_group(child.pid)
        child.wait(timeout=2)
        exited = time.time()
        collector.finish()
        cleanup = cleanup_group(child.pid, collector.capture_owned)
    return status, reason, launched, exited, cleanup


def wait_child(child, timeout: float) -> tuple[int, str]:
    try:
        status = child.wait(timeout=timeout)
        return status, "exited"
    except InterruptedError:
        terminate_group(child.pid)
        kill_group(child.pid)
        child.wait(timeout=2)
        return 143, "interrupted"
    except subprocess.TimeoutExpired:
        terminate_group(child.pid)
        try:
            child.wait(timeout=2)
        except subprocess.TimeoutExpired:
            kill_group(child.pid)
            child.wait(timeout=2)
        return 124, "timeout"


def cleanup_group(group: int, identities: set) -> bool:
    terminate_group(group)
    # Kill the isolated group even when its root has exited with a surviving descendant.
    kill_group(group)
    current = snapshot()
    for process in current.processes:
        if not process.live or process.identity not in identities:
            continue
        kill_identity(process.pid)
    rows = command_text(["ps", "-axo", "pgid=,stat="])
    group_stopped = not any(
        int(fields[0]) == group and not fields[1].startswith("Z")
        for fields in (row.split() for row in rows.splitlines())
    )
    remaining = snapshot()
    return group_stopped and not any(
        p.live and p.identity in identities for p in remaining.processes
    )


def kill_identity(pid: int) -> None:
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        return
