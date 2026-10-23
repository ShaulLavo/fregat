#!/usr/bin/env python3
"""Collect actual host telemetry for one production capture command."""

import argparse
from pathlib import Path

from host_telemetry import run_capture


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--adapter-config", type=Path, required=True)
    parser.add_argument("--timeout-seconds", type=float, required=True)
    parser.add_argument("--interval-seconds", type=float, default=2)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if not 0 < args.timeout_seconds <= 6600:
        parser.error("--timeout-seconds must be positive and at most 6600")
    if not 0 < args.interval_seconds <= 2:
        parser.error("--interval-seconds must be positive and at most 2")
    if not args.command or args.command.pop(0) != "--" or not args.command:
        parser.error("Supply the capture command after --")
    return run_capture(args)


if __name__ == "__main__":
    raise SystemExit(main())
