#!/usr/bin/env python3
"""Check the nightly source pin and inventory repository T3 Code references."""

import argparse
import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = Path(__file__).resolve().parent
PATTERN = re.compile(r"t3.?code|references/t3code|7445aa73", re.IGNORECASE)
ACTIVE = {
    "AGENTS.md", "PLAN.md", "plans/README.md", "docs/README.md",
    "docs/t3code-reference.md", "docs/product-vision.md",
    "plans/126-t3code-alignment.md", "scripts/parity/README.md",
}
HISTORICAL = {
    "plans/t3code-parity-implementation-plan.md",
    "plans/t3code-chat-parity-gap-analysis.md",
    "docs/t3code-persistence-alignment.md", "docs/t3code-parity-second-sweep.md",
    "docs/chat-t3code-parity.md", "docs/chat-t3code-decisions.tsv",
}


def git(*arguments, cwd=ROOT):
    return subprocess.check_output(["git", "-C", str(cwd), *arguments], text=True).strip()


def category(path):
    if path in ACTIVE or path.startswith("plans/343-"):
        return "current-direction"
    if path in HISTORICAL or path.startswith("plans/126-t3code-alignment/"):
        return "historical-alignment"
    if path.startswith(("scripts/parity/", "test/parity/")) or "t3code.test" in path:
        return "frozen-comparison"
    if path.startswith(("apps/", "packages/", "ghostty-webgpu/", "scripts/")):
        return "implementation-or-attribution"
    return "context-reference"


def inventory():
    found = subprocess.run(
        ["git", "-C", str(ROOT), "grep", "-I", "-n", "-i", "-E", PATTERN.pattern],
        text=True, capture_output=True, check=False,
    )
    if found.returncode not in (0, 1):
        raise SystemExit(found.stderr)
    paths = {line.split(":", 1)[0] for line in found.stdout.splitlines()}
    paths.update(git("ls-files", "--others", "--exclude-standard", "-z").split("\0"))
    return [row for path in sorted(paths) if (row := inventory_row(path))]


def inventory_row(path):
    if not path or path.startswith("plans/343-t3code-nightly/"):
        return None
    source = ROOT / path
    if not source.is_file():
        return None
    data = source.read_bytes()
    if b"\0" in data:
        return None
    text = data.decode("utf-8", errors="replace")
    matches = [i for i, line in enumerate(text.splitlines(), 1) if PATTERN.search(line)]
    if matches:
        return {"path": path, "category": category(path), "lines": matches}
    return None


def check_pin(reference):
    pin = json.loads((DIRECTORY / "reference-pin.json").read_text())
    commit = pin["commit"]
    if git("rev-parse", pin["tag"] + "^{}", cwd=reference) != commit:
        raise SystemExit("Nightly tag differs from the recorded source commit")
    for path, expected in pin["source_objects"].items():
        if git("rev-parse", commit + ":" + path, cwd=reference) != expected:
            raise SystemExit("Nightly source object differs: " + path)
    print("Nightly tag and all source objects match " + commit)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--reference", type=Path)
    args = parser.parse_args()
    output = DIRECTORY / "reference-inventory.json"
    records = inventory()
    if args.write:
        output.write_text(json.dumps(records, indent=2) + "\n")
    if not output.exists() or json.loads(output.read_text()) != records:
        raise SystemExit("Reference inventory changed. Review it, then rerun with --write")
    print("Repository reference inventory matches")
    if args.reference:
        check_pin(args.reference.resolve())


if __name__ == "__main__":
    main()
