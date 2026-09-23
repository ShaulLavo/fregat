#!/usr/bin/env python3
"""Execute one mapped paired scenario and retain validated observations without changing review status."""

import argparse
import json
import os
import subprocess
from pathlib import Path

from check import ROOT
from evidence import (
    InvalidRecord, case_ids, check_comparison, check_controls,
    check_sources, checked_artifact, digest, read_json, records, relative_path, require, same_output,
)
from source import ARTIFACT, check_mapping


def snapshot(root, path):
    return {"path": path, "sha256": digest(checked_artifact(root, path))}


def execute(root, scenario, commit, subject, timeout):
    environment = dict(os.environ, PARITY_UPSTREAM_COMMIT=commit, PARITY_SUBJECT=subject)
    result = subprocess.run(scenario["command"], cwd=root, env=environment, text=True,
                            capture_output=True, timeout=timeout, check=True)
    payload = json.loads(result.stdout)
    require(isinstance(payload, dict), "Runner emitted an invalid report")
    require(payload.get("upstreamCommit") == commit, "Runner emitted a stale upstream pin")
    rows = payload.get("cases")
    require(isinstance(rows, list) and bool(rows), "Runner emitted no cases")
    records(rows, "runner cases")
    identifiers = case_ids([row.get("id") for row in rows], "runner")
    require(set(identifiers) == set(scenario["cases"]), "Runner case coverage mismatch")
    for row in rows:
        require("upstream" in row and "local" in row, f"{row['id']}: missing paired observations")
        require(same_output(row["upstream"], row["local"]), f"{row['id']}: observed outputs differ")
    check_controls(payload.get("negativeControls"), {row["id"]: row["upstream"] for row in rows})
    return payload


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def save_comparison(root, directory, subject, commit, scenario, sources, payload):
    output = root / relative_path(directory, "Output directory")
    require(output.resolve().is_relative_to(root.resolve()), "Output directory escapes repository")
    require(not output.exists(), "Output directory already exists; preserve the earlier comparison")
    output.mkdir(parents=True)
    artifacts = {}
    for side in ("upstream", "local"):
        path = output / f"{side}.json"
        write_json(path, {"upstreamCommit": commit, "subject": subject, "scenarioId": scenario["id"],
                         "cases": [{"id": row["id"], "output": row[side]} for row in payload["cases"]]})
        artifacts[side] = snapshot(root, path.relative_to(root).as_posix())
    report_path = output / "comparison.json"
    write_json(report_path, {
        "schemaVersion": 1, "upstreamCommit": commit, "subject": subject,
        "result": "matched", "scenario": scenario, "sources": sources, "artifacts": artifacts,
        "cases": [{"id": identifier, "result": "matched"} for identifier in scenario["cases"]],
        "negativeControls": payload["negativeControls"],
    })
    comparison = {
        "upstream_commit": commit, "result": "matched",
        "upstream_artifact": artifacts["upstream"]["path"],
        "local_artifact": artifacts["local"]["path"],
        "comparison_artifact": report_path.relative_to(root).as_posix(),
    }
    check_comparison(comparison, root, commit, subject, scenario)
    return comparison


def run(args):
    root = args.root.resolve()
    inventory = read_json(root / "plans/126-t3code-alignment/inventory.json")
    commit = inventory["upstream_commit"]
    artifact = read_json(root / ARTIFACT)
    require(artifact.get("upstreamCommit") == commit, "Operation artifact pin drift; review required")
    rows = [row for row in artifact["operations"] if row["id"] == args.operation]
    require(len(rows) == 1, "Missing or duplicate operation")
    row = rows[0]
    require(row.get("review") in {"source-reviewed", "runtime-verified"}, "Review the mapping before running its comparison")
    check_mapping(row, root, args.reference or root / "references/t3code", commit)
    scenarios = [scenario for scenario in row["scenarios"] if scenario["id"] == args.scenario]
    require(len(scenarios) == 1, "Missing or duplicate scenario")
    scenario = scenarios[0]
    paths = sorted({scenario["runner"], *[entry["path"] for entry in row["localMapping"]["entryPoints"]]})
    sources = [snapshot(root, path) for path in paths]
    payload = execute(root, scenario, commit, row["id"], args.timeout)
    check_sources(root, sources, paths)
    if args.check:
        print(f"Matched {len(payload['cases'])} case groups and rejected {len(payload['negativeControls'])} "
              f"negative controls for {scenario['id']} at {commit}. Whole-operation parity remains unverified.")
        return
    comparison = save_comparison(root, args.output, row["id"], commit, scenario, sources, payload)
    print(json.dumps(comparison, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--reference", type=Path)
    parser.add_argument("--operation", required=True)
    parser.add_argument("--scenario", required=True)
    output = parser.add_mutually_exclusive_group(required=True)
    output.add_argument("--output", help="New repository-relative directory for durable evidence")
    output.add_argument("--check", action="store_true", help="Execute and validate without writing artifacts")
    parser.add_argument("--timeout", type=int, default=600)
    args = parser.parse_args()
    try:
        require(args.timeout > 0, "Timeout must be positive")
        run(args)
    except subprocess.CalledProcessError as error:
        parser.exit(1, f"Scenario exited {error.returncode}: {error.stderr}\n")
    except (InvalidRecord, OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
        parser.exit(1, f"Runtime comparison failed: {error}\n")


if __name__ == "__main__":
    main()
