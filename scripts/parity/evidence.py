"""Validate bounded runtime comparison records and their recorded observations."""

import hashlib
import json
from pathlib import Path


class InvalidRecord(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise InvalidRecord(message)


def read_json(path):
    return json.loads(path.read_text())


def unique(values, label):
    require(len(values) == len(set(values)), f"Duplicate {label}")


def text(value, label):
    require(isinstance(value, str) and bool(value.strip()), f"Missing {label}")


def relative_path(value, label):
    text(value, label)
    path = Path(value)
    require(not path.is_absolute(), f"{label} must be repository-relative")
    require(".." not in path.parts, f"{label} escapes repository")
    require(str(path) == value and value != ".", f"{label} must use a canonical relative path")
    return path


def checked_artifact(root, value):
    path = relative_path(value, "Comparison artifact")
    resolved = (root / path).resolve()
    require(resolved.is_relative_to(root.resolve()), "Comparison artifact escapes repository")
    require(resolved.is_file(), f"Missing comparison artifact: {value}")
    return resolved


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def case_ids(cases, label):
    require(isinstance(cases, list) and bool(cases), f"{label}: missing cases")
    for identifier in cases:
        text(identifier, f"{label} case id")
    unique(cases, f"{label} case")
    return cases


def records(value, label):
    require(isinstance(value, list) and bool(value), f"Missing {label}")
    require(all(isinstance(entry, dict) for entry in value), f"Invalid {label}")
    return value


def check_scenario(scenario, root):
    require(isinstance(scenario, dict), "Invalid executable scenario")
    text(scenario.get("id"), "scenario id")
    runner = scenario.get("runner")
    checked_artifact(root, runner)
    command = scenario.get("command")
    require(isinstance(command, list) and bool(command), "Missing scenario command")
    for argument in command:
        text(argument, "scenario command argument")
    require(runner in command, "Scenario command must invoke its runner")
    executables = {"bun", "node", "python3"}
    require(command[0] in executables, "Scenario command must use bun, node or python3")
    require(command.index(runner) == 1, "Scenario runner must be the command entry point")
    case_ids(scenario.get("cases"), scenario["id"])


def checked_snapshot(root, snapshot):
    require(isinstance(snapshot, dict), "Missing artifact snapshot")
    path = checked_artifact(root, snapshot.get("path"))
    require(snapshot.get("sha256") == digest(path), f"Artifact content changed: {snapshot['path']}")
    return path


def check_sources(root, sources, required):
    records(sources, "source snapshots")
    paths = [entry.get("path") for entry in sources]
    unique(paths, "source snapshot")
    require(set(required).issubset(paths), "Comparison omits executable or local source snapshots")
    for entry in sources:
        checked_snapshot(root, entry)


def outputs(artifact, subject, commit, scenario):
    require(isinstance(artifact, dict), "Invalid observation artifact")
    require(artifact.get("upstreamCommit") == commit, "Stale observation pin")
    require(artifact.get("subject") == subject, "Observation subject mismatch")
    require(artifact.get("scenarioId") == scenario["id"], "Observation scenario mismatch")
    rows = records(artifact.get("cases"), "observation cases")
    identifiers = case_ids([row.get("id") for row in rows], "observation")
    require(set(identifiers) == set(scenario["cases"]), "Observation case coverage mismatch")
    for row in rows:
        require("output" in row, f"{row['id']}: missing observed output")
    return {row["id"]: row["output"] for row in rows}


def same_output(left, right):
    return json.dumps(left, sort_keys=True, allow_nan=False) == json.dumps(right, sort_keys=True, allow_nan=False)


def check_case_results(cases, expected):
    records(cases, "comparison case results")
    identifiers = case_ids([case.get("id") for case in cases], "comparison")
    require(set(identifiers) == set(expected), "Comparison case coverage mismatch")
    require(all(case.get("result") == "matched" for case in cases), "Comparison includes failed or skipped cases")


def check_controls(controls, expected):
    records(controls, "negative controls")
    case_ids([control.get("id") for control in controls], "negative control")
    require(all(control.get("result") == "rejected" for control in controls), "Negative control was not rejected")
    for control in controls:
        require(control.get("caseId") in expected, "Negative control references an unknown case")
        require("output" in control, "Negative control omitted its observation")
        require(not same_output(control["output"], expected[control["caseId"]]), "Negative control matches the upstream observation")


def check_comparison(comparison, root, commit, subject, scenario=None, required_sources=()):
    require(isinstance(comparison, dict), f"{subject}: missing runtime_comparison")
    require(comparison.get("upstream_commit") == commit, f"{subject}: stale comparison pin")
    require(comparison.get("result") == "matched", f"{subject}: comparison did not match")
    fields = ("upstream_artifact", "local_artifact", "comparison_artifact")
    paths = [checked_artifact(root, comparison.get(field)) for field in fields]
    unique(paths, "comparison artifacts")
    report = read_json(paths[2])
    require(isinstance(report, dict), "Invalid comparison report")
    require(report.get("schemaVersion") == 1, "Unsupported comparison report schema")
    require(report.get("upstreamCommit") == commit, "Stale comparison report pin")
    require(report.get("subject") == subject, "Comparison subject mismatch")
    require(report.get("result") == "matched", "Comparison report did not match")
    recorded = report.get("scenario")
    check_scenario(recorded, root)
    require(scenario is None or scenario == recorded, "Comparison executable scenario mismatch")
    check_sources(root, report.get("sources"), [recorded["runner"], *required_sources])
    observations = comparison_outputs(report, comparison, root, commit, subject, recorded)
    check_case_results(report.get("cases"), recorded["cases"])
    check_controls(report.get("negativeControls"), observations[0])
    for identifier in recorded["cases"]:
        require(same_output(observations[0][identifier], observations[1][identifier]), f"{identifier}: observed outputs differ")
    return recorded


def comparison_outputs(report, comparison, root, commit, subject, scenario):
    artifacts = report.get("artifacts")
    require(isinstance(artifacts, dict), "Missing comparison artifact snapshots")
    result = []
    for side in ("upstream", "local"):
        snapshot = artifacts.get(side)
        path = checked_snapshot(root, snapshot)
        require(snapshot["path"] == comparison[f"{side}_artifact"], f"{side}: artifact reference mismatch")
        result.append(outputs(read_json(path), subject, commit, scenario))
    return result
