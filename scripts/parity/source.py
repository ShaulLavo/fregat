#!/usr/bin/env python3
"""Compare pinned source and command membership with reviewed census artifacts."""

import argparse
import json
import re
import subprocess
from pathlib import Path

from check import ROOT, InvalidRecord, read_json, require, unique

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


def check_operations(artifact, commit, upstream, local):
    require(artifact["upstreamCommit"] == commit, "Operation artifact pin drift; review required")
    require(artifact["upstream"] == upstream, "Upstream operation census drift; review required")
    require(artifact["localCommands"] == local, "Local command census drift; review required")
    rows = artifact["operations"]
    identifiers = [row["id"] for row in rows]
    unique(identifiers, "operation row")
    require(set(identifiers) == set(operation_ids(upstream)), "Missing or unknown operation rows; review required")
    for row in rows:
        require(row.get("review") == "unverified", f"{row['id']}: reviewed mappings need a behavioral checker")
        require(bool(row.get("reason")), f"{row['id']}: missing review reason")
        require(row.get("localMapping") is None, f"{row['id']}: unreviewed mapping cannot claim equivalence")
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
    count = check_operations(read_json(path), inventory["upstream_commit"], upstream, local)
    print(f"Pinned source and command census valid: {count} operation rows, all unverified. Behavioral parity remains unproven.")


if __name__ == "__main__":
    main()
