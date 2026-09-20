#!/usr/bin/env python3
"""Check the pinned source census and plan records, not behavioral parity."""

import argparse
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT / "references/t3code"
UPSTREAM = "7445aa733ada33e45289e5aa5055f79142556513"
PLATFORM = "3c9b88c35784e571e706600b0cee8e95a2656f77"
SNAPSHOT = Path(__file__).with_name("inventory.json")


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args], text=True)


def source(repo, revision, path):
    return git(repo, "show", f"{revision}:{path}")


def files(repo, revision, prefix):
    return git(repo, "ls-tree", "-r", "--name-only", revision, "--", prefix).splitlines()


def declarations(repo, revision, path):
    content = source(repo, revision, path)
    pattern = r"^export (?:const|class|function|interface|type) (\w+)"
    return sorted(set(re.findall(pattern, content, re.MULTILINE)))


def rpc_methods(revision):
    content = source(REFERENCE, revision, "packages/contracts/src/rpc.ts")
    block = content.split("export const WS_METHODS = {", 1)[1].split("} as const", 1)[0]
    orchestration = source(REFERENCE, revision, "packages/contracts/src/orchestration.ts")
    block += orchestration.split("export const ORCHESTRATION_WS_METHODS = {", 1)[1].split(
        "} as const", 1
    )[0]
    return sorted(set(re.findall(r'^\s*\w+: "([^\"]+)"', block, re.MULTILINE)))


def command_types(repo, revision, path, literal):
    content = source(repo, revision, path)
    pattern = rf"type:\s*{literal}\(['\"]([^'\"]+)['\"]\)"
    return sorted(set(re.findall(pattern, content)))


def contract_inventory(revision):
    paths = files(REFERENCE, revision, "packages/contracts/src")
    return {
        path: declarations(REFERENCE, revision, path)
        for path in paths
        if path.endswith(".ts") and ".test." not in path and not path.endswith("/index.ts")
    }


def census(revision):
    methods = rpc_methods(revision)
    families = sorted({method.split(".")[0] for method in methods})
    contracts = contract_inventory(revision)
    return {
        "platform_commit": PLATFORM,
        "upstream_commit": revision,
        "warning": "Declarations and names are coverage leads, not semantic equivalence tests.",
        "upstream_apps": git(REFERENCE, "ls-tree", "--name-only", f"{revision}:apps").splitlines(),
        "upstream_contracts": contracts,
        "upstream_contract_blobs": {
            path: git(REFERENCE, "rev-parse", f"{revision}:{path}").strip()
            for path in contracts
        },
        "upstream_rpc_methods": methods,
        "upstream_rpc_families": families,
        "upstream_type_discriminants": command_types(
            REFERENCE, revision, "packages/contracts/src/orchestration.ts", r"Schema\.Literal"
        ),
        "platform_command_discriminants": command_types(
            ROOT, PLATFORM, "packages/contracts/src/orchestration-commands.ts", r"v\.literal"
        ),
    }


def report_findings(directory):
    findings = {}
    pattern = r"^### \[?((?:LIFE|INTERACTION|RUNTIME|EXT)-\d+)\]?(?:\s*—|:)?\s+(.+)$"
    for report in ("lifecycle.md", "interaction.md", "runtime.md", "adjacent.md"):
        content = (directory / report).read_text()
        for finding, title in re.findall(pattern, content, re.MULTILINE):
            if finding in findings:
                raise SystemExit(f"Duplicate report finding: {finding}")
            findings[finding] = {"report": report, "title": title}
    return findings


def check_finding(finding, reports):
    identifier = finding["id"]
    expected = reports[identifier]
    for field in ("report", "title"):
        if finding[field] != expected[field]:
            raise SystemExit(f"{identifier}: stale {field}")
    if finding["wave"] not in {str(wave) for wave in range(7)}:
        raise SystemExit(f"{identifier}: missing or invalid delivery wave")
    if finding["status"] not in {"open", "in-progress", "verified"}:
        raise SystemExit(f"{identifier}: invalid status")
    if not finding.get("acceptance") or not finding.get("evidence_level"):
        raise SystemExit(f"{identifier}: missing acceptance or evidence level")
    if finding["status"] == "verified" and not finding.get("execution_evidence"):
        raise SystemExit(f"{identifier}: verified without execution evidence")


def check_plan(current):
    directory = SNAPSHOT.parent
    reports = report_findings(directory)
    findings = json.loads((directory / "ledger.json").read_text())["findings"]
    identifiers = [finding["id"] for finding in findings]
    if len(identifiers) != len(set(identifiers)):
        raise SystemExit("Duplicate ledger finding")
    if set(identifiers) != set(reports):
        raise SystemExit(f"Ledger/report mismatch: {set(identifiers) ^ set(reports)}")
    for finding in findings:
        check_finding(finding, reports)
    coverage = json.loads((directory / "coverage.json").read_text())["contracts"]
    if set(coverage) != set(current["upstream_contracts"]):
        raise SystemExit("Contract coverage differs from the pinned census")
    for path, entry in coverage.items():
        if not entry["findings"] or not set(entry["findings"]).issubset(reports):
            raise SystemExit(f"{path}: missing or unknown finding assignment")
    return findings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream", default=UPSTREAM)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    current = census(args.upstream)
    if args.write:
        SNAPSHOT.write_text(json.dumps(current, indent=2) + "\n")
        print(f"Wrote {SNAPSHOT.relative_to(ROOT)}")
        return
    expected = json.loads(SNAPSHOT.read_text())
    if current != expected:
        changed = [key for key in current if current[key] != expected.get(key)]
        raise SystemExit("Census changed; review before accepting: " + ", ".join(changed))
    findings = check_plan(current)
    open_count = sum(finding["status"] != "verified" for finding in findings)
    print(
        f"Pinned census verified: {len(current['upstream_contracts'])} contract modules, "
        f"{len(current['upstream_rpc_methods'])} RPC methods. "
        f"Plan records verified: {len(findings)} groups, {open_count} unverified. "
        "Behavioral parity remains unproven."
    )


if __name__ == "__main__":
    main()
