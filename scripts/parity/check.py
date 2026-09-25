#!/usr/bin/env python3
"""Validate committed alignment records offline, without asserting behavioral parity."""

import argparse
import re
from pathlib import Path

from evidence import InvalidRecord, check_comparison, read_json, require, unique

ROOT = Path(__file__).resolve().parents[2]
REPORTS = ("lifecycle.md", "interaction.md", "runtime.md", "adjacent.md")
FINDING = re.compile(
    r"^### \[?((?:LIFE|INTERACTION|RUNTIME|EXT)-\d+)\]?(?:\s*—|:)?\s+(.+)$",
    re.MULTILINE,
)


def report_findings(directory):
    findings = {}
    for report in REPORTS:
        for identifier, title in FINDING.findall((directory / report).read_text()):
            require(identifier not in findings, f"Duplicate report finding: {identifier}")
            findings[identifier] = {"report": report, "title": title}
    return findings


SCENARIO = re.compile(r"scripts/agent/scenarios/[\w-]+\.ts")


def check_scenario_verified(finding, root):
    # The owner's definition of done: our agent:browser scenario proves the row; no paired upstream run.
    identifier = finding["id"]
    scenarios = [path for item in finding["execution_evidence"] for path in SCENARIO.findall(str(item))]
    require(bool(scenarios), f"{identifier}: scenario-verified must name scripts/agent/scenarios/<name>.ts")
    for path in scenarios:
        require((root / path).is_file(), f"{identifier}: missing scenario {path}")


def check_verified(finding, root, commit):
    identifier = finding["id"]
    if finding["evidence_level"] == "scenario-verified":
        check_scenario_verified(finding, root)
        return
    require(
        finding["evidence_level"] == "runtime-compared",
        f"{identifier}: verified requires runtime-compared or scenario-verified evidence, not source review",
    )
    check_comparison(finding.get("runtime_comparison"), root, commit, identifier)


def check_finding(finding, reports, root, commit):
    identifier = finding["id"]
    for field in ("title", "report"):
        require(finding.get(field) == reports[identifier][field], f"{identifier}: stale {field}")
    require(finding.get("wave") in {str(n) for n in range(7)}, f"{identifier}: invalid wave")
    require(finding.get("status") in {"open", "in-progress", "verified"}, f"{identifier}: invalid status")
    for field in ("acceptance", "evidence_level"):
        require(bool(finding.get(field)), f"{identifier}: missing {field}")
    require(isinstance(finding.get("execution_evidence"), list), f"{identifier}: invalid evidence list")
    if finding["status"] != "verified":
        return
    require(bool(finding["execution_evidence"]), f"{identifier}: verified without evidence")
    check_verified(finding, root, commit)


def check_fixtures(root, commit):
    fixtures = sorted((root / "test/parity/t3code").glob("*.json"))
    for path in fixtures:
        fixture = read_json(path)
        require(fixture.get("upstreamCommit") == commit, f"{path.name}: stale fixture pin")
        require(bool(fixture.get("sources")), f"{path.name}: missing upstream sources")
        evidence = fixture.get("evidence")
        require(isinstance(evidence, str), f"{path.name}: missing evidence provenance")
        if evidence.startswith("source-derived"):
            continue
        require(evidence == "runtime-compared", f"{path.name}: unknown evidence provenance")
        check_verified({
            "id": path.name, "evidence_level": evidence,
            "runtime_comparison": fixture.get("runtime_comparison"),
        }, root, commit)
    return len(fixtures)


def check(root=ROOT):
    directory = root / "plans/126-t3code-alignment"
    inventory = read_json(directory / "inventory.json")
    commit = inventory["upstream_commit"]
    require(bool(re.fullmatch(r"[0-9a-f]{40}", commit)), "Invalid upstream commit")
    contracts = inventory["upstream_contracts"]
    require(set(contracts) == set(inventory["upstream_contract_blobs"]), "Contract blob inventory mismatch")
    for field in ("upstream_rpc_methods", "upstream_type_discriminants", "platform_command_discriminants"):
        unique(inventory[field], field)
    reports = report_findings(directory)
    findings = read_json(directory / "ledger.json")["findings"]
    identifiers = [finding["id"] for finding in findings]
    unique(identifiers, "ledger finding")
    require(set(identifiers) == set(reports), "Ledger/report finding mismatch")
    for finding in findings:
        check_finding(finding, reports, root, commit)
    coverage = read_json(directory / "coverage.json")["contracts"]
    require(set(coverage) == set(contracts), "Contract coverage differs from committed inventory")
    for path, entry in coverage.items():
        assigned = entry["findings"]
        require(bool(assigned) and set(assigned).issubset(reports), f"{path}: missing or unknown finding")
        unique(assigned, f"finding assignment in {path}")
        require(bool(entry.get("review_state")), f"{path}: missing review state")
    fixtures = check_fixtures(root, commit)
    remaining = sum(finding["status"] != "verified" for finding in findings)
    return (
        f"Offline records valid: {len(contracts)} contract modules, "
        f"{len(inventory['upstream_rpc_methods'])} named RPC methods, "
        f"{len(findings)} finding groups, {remaining} unverified, {fixtures} provenance-stamped fixtures.\n"
        "Operation/default mapping and source drift are not checked. "
        "Type discriminants include events and data variants; they are not a command inventory.\n"
        "Validated runtime reports establish recorded case agreement only. Behavioral parity remains unproven."
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    try:
        print(check(args.root))
    except (InvalidRecord, OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(1, f"Alignment record check failed: {error}\n")


if __name__ == "__main__":
    main()
