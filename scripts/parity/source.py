#!/usr/bin/env python3
"""Compare pinned source and command membership with reviewed census artifacts."""

import argparse
import json
import re
import subprocess
from pathlib import Path

from check import ROOT, InvalidRecord, read_json, require, unique
from evidence import check_comparison, check_scenario, checked_artifact, relative_path, text

COMMAND_PATH = "packages/contracts/src/orchestration.ts"
ARTIFACT = "test/parity/t3code/operations.json"


def git(reference, *args):
    return subprocess.check_output(["git", "-C", str(reference), *args], text=True).strip()


def source(reference, commit, path):
    return git(reference, "show", f"{commit}:{path}")


def command_members(content, union):
    pattern = rf"(?:export )?const {union} = Schema\.Union\(\[([\s\S]*?)\]\)"
    match = re.search(pattern, content)
    require(match is not None, f"Cannot classify upstream union: {union}")
    body = re.sub(r"//[^\n]*", "", match[1])
    names = [name.strip() for name in body.split(",") if name.strip()]
    require(all(re.fullmatch(r"\w+", name) for name in names), f"Unsupported union shape: {union}")
    return sorted(set(names))


def command_literal(content, name):
    pattern = rf"(?:export )?const {name} = Schema\.Struct\(\{{([\s\S]*?)^\}}\);"
    match = re.search(pattern, content, re.MULTILINE)
    require(match is not None, f"Cannot classify upstream command: {name}")
    literal = re.search(r'^  type: Schema\.Literal\("([^\"]+)"\)', match[1], re.MULTILINE)
    require(literal is not None, f"Missing direct command type: {name}")
    return literal[1]


def upstream_commands(content):
    result = {}
    for kind, union in (
        ("client", "ClientOrchestrationCommand"),
        ("internal", "InternalOrchestrationCommand"),
    ):
        result[kind] = {name: command_literal(content, name) for name in command_members(content, union)}
    return result


def rpc_methods(content, name):
    match = re.search(rf"export const {name} = \{{([\s\S]*?)\}} as const", content)
    require(match is not None, f"Missing RPC registry: {name}")
    return re.findall(r'^\s*\w+: "([^\"]+)"', match[1], re.MULTILINE)


def pinned_census(reference, inventory):
    commit = inventory["upstream_commit"]
    require(git(reference, "rev-parse", f"{commit}^{{commit}}") == commit, "Upstream pin mismatch")
    paths = git(reference, "ls-tree", "-r", "--name-only", commit, "--", "packages/contracts/src").splitlines()
    paths = [path for path in paths if path.endswith(".ts") and ".test." not in path and not path.endswith("/index.ts")]
    blobs = {path: git(reference, "rev-parse", f"{commit}:{path}") for path in paths}
    require(blobs == inventory["upstream_contract_blobs"], "Pinned contract source drift; review required")
    orchestration = source(reference, commit, COMMAND_PATH)
    methods = rpc_methods(source(reference, commit, "packages/contracts/src/rpc.ts"), "WS_METHODS")
    methods += rpc_methods(orchestration, "ORCHESTRATION_WS_METHODS")
    methods = sorted(set(methods))
    require(methods == inventory["upstream_rpc_methods"], "RPC inventory drift; review required")
    return {"rpc": methods, "commands": upstream_commands(orchestration)}


def local_census(root):
    output = subprocess.check_output(["bun", str(root / "scripts/parity/local-commands.ts")], cwd=root, text=True)
    return json.loads(output)


def operation_ids(upstream):
    result = [f"rpc:{name}" for name in upstream["rpc"]]
    for kind, members in upstream["commands"].items():
        result.extend(f"{kind}-command:{value}" for value in sorted(set(members.values())))
    return sorted(result)


def initial_artifact(commit, upstream, local):
    return {
        "upstreamCommit": commit,
        "evidence": "source-derived; operation identity only, no behavioral comparison",
        "sources": {"rpc": "packages/contracts/src/rpc.ts", "commands": COMMAND_PATH},
        "upstream": upstream,
        "localCommands": local,
        "operations": [{
            "id": identifier,
            "review": "unverified",
            "reason": "Behavior, capability, local entry point, defaults and negative paths need review.",
            "localMapping": None,
            "scenarios": [],
        } for identifier in operation_ids(upstream)],
    }


def check_anchors(anchors, read, label):
    require(isinstance(anchors, list) and bool(anchors), f"{label}: missing source anchors")
    for anchor in anchors:
        require(isinstance(anchor, dict), f"{label}: invalid source anchor")
        path = str(relative_path(anchor.get("path"), f"{label} source path"))
        text(anchor.get("contains"), f"{label} source anchor")
        require(anchor["contains"] in read(path), f"{label}: source anchor absent from {path}")


def check_mapping(row, root, reference, commit):
    identifier = row["id"]
    check_anchors(row.get("upstreamAnchors"), lambda path: source(reference, commit, path), identifier)
    mapping = row.get("localMapping")
    require(isinstance(mapping, dict), f"{identifier}: missing local mapping")
    check_anchors(mapping.get("entryPoints"), lambda path: checked_artifact(root, path).read_text(), identifier)
    for field in ("owner", "capability", "defaults", "results", "navigation", "persistence", "negativePaths"):
        text(mapping.get(field), f"{identifier} {field}")
    scenarios = row.get("scenarios")
    require(isinstance(scenarios, list) and bool(scenarios), f"{identifier}: missing executable scenarios")
    for scenario in scenarios:
        check_scenario(scenario, root)
    unique([scenario["id"] for scenario in scenarios], f"{identifier} scenario")


def check_runtime(row, root, commit):
    comparisons = row.get("runtimeComparisons")
    require(isinstance(comparisons, list) and bool(comparisons), f"{row['id']}: missing runtime comparisons")
    scenarios = {scenario["id"]: scenario for scenario in row["scenarios"]}
    sources = [anchor["path"] for anchor in row["localMapping"]["entryPoints"]]
    recorded = [check_comparison(comparison, root, commit, row["id"], required_sources=sources)
                for comparison in comparisons]
    identifiers = [scenario["id"] for scenario in recorded]
    unique(identifiers, f"{row['id']} runtime scenario")
    require(set(identifiers) == set(scenarios), f"{row['id']}: runtime scenario coverage mismatch")
    for scenario in recorded:
        require(scenario == scenarios[scenario["id"]], "Comparison executable scenario mismatch")


def check_operation(row, root, reference, commit):
    identifier = row["id"]
    review = row.get("review")
    require(review in {"unverified", "source-reviewed", "runtime-verified"}, f"{identifier}: invalid review state")
    text(row.get("reason"), f"{identifier} review reason")
    if review == "unverified":
        require(row.get("localMapping") is None, f"{identifier}: unreviewed mapping cannot claim equivalence")
        require(not row.get("runtimeComparisons"), f"{identifier}: unreviewed mapping cannot claim runtime evidence")
        return
    check_mapping(row, root, reference, commit)
    if review == "source-reviewed":
        require(not row.get("runtimeComparisons"), f"{identifier}: source review cannot claim runtime evidence")
        return
    check_runtime(row, root, commit)


def check_operations(artifact, commit, upstream, local, root=ROOT, reference=None):
    require(artifact["upstreamCommit"] == commit, "Operation artifact pin drift; review required")
    require(artifact["upstream"] == upstream, "Upstream operation census drift; review required")
    require(artifact["localCommands"] == local, "Local command census drift; review required")
    rows = artifact["operations"]
    identifiers = [row["id"] for row in rows]
    unique(identifiers, "operation row")
    require(set(identifiers) == set(operation_ids(upstream)), "Missing or unknown operation rows; review required")
    for row in rows:
        check_operation(row, root, reference or root / "references/t3code", commit)
    return len(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--reference", type=Path)
    parser.add_argument("--initialize", action="store_true", help="Create an absent operation artifact with every mapping unverified")
    args = parser.parse_args()
    try:
        run(args)
    except (InvalidRecord, OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Source census check failed: {error}\n")


def run(args):
    inventory = read_json(args.root / "plans/126-t3code-alignment/inventory.json")
    upstream = pinned_census(args.reference or args.root / "references/t3code", inventory)
    local = local_census(args.root)
    path = args.root / ARTIFACT
    if args.initialize:
        require(not path.exists(), "Operation artifact exists; refusing to overwrite reviewed data")
        path.write_text(json.dumps(initial_artifact(inventory["upstream_commit"], upstream, local), indent=2) + "\n")
    artifact = read_json(path)
    count = check_operations(artifact, inventory["upstream_commit"], upstream, local, args.root, args.reference)
    states = {state: sum(row["review"] == state for row in artifact["operations"])
              for state in ("unverified", "source-reviewed", "runtime-verified")}
    counts = ", ".join(f"{count} {state}" for state, count in states.items())
    print(f"Pinned source and command census valid: {count} operation rows, {counts}. Recorded cases do not establish whole-operation parity.")


if __name__ == "__main__":
    main()
