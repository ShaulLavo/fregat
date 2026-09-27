#!/usr/bin/env python3
"""List prompt producers and transport candidates for manual audit from any cwd."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PATTERNS = {
    "instructions": r"(?i)(prompt|instructions|systemPrompt|additionalContext|hookSpecificOutput)",
    "transports": r"(messageText|generateText|sendTurn|sendFollowUp|appendText|startSession|startTurn|pending\.resolve|input:|content:|text:)",
    "prose": r"(?i)['\"`](continue|resume|retry|implement|fix|investigate|review|write|create|draft|summarize|report|you are|your |the user|ask |attached file)",
}
EXCLUDE = [
    "!**/node_modules/**", "!**/dist/**", "!**/build/**",
    "!**/tests/**", "!**/test/**", "!**/__tests__/**",
    "!**/*.test.*", "!**/*.spec.*", "!**/codex-protocol/**",
    "!**/*.gen.*", "!**/demo/**", "!scripts/agent/scenarios/**",
    "!scripts/prompts/**",
]


def candidates(pattern):
    command = ["rg", "--line-number", "--no-heading", "--color", "never"]
    for glob in ["*.ts", "*.tsx", "*.js", "*.mjs", "*.py", "*.swift", "*.md", *EXCLUDE]:
        command.extend(["--glob", glob])
    result = subprocess.run(
        [*command, "--", pattern, "apps", "packages", "scripts"],
        cwd=ROOT, text=True, capture_output=True, check=False,
    )
    if result.returncode not in (0, 1):
        raise SystemExit(result.stderr)
    return result.stdout.splitlines()


if __name__ == "__main__":
    print("# Prompt discovery candidates (manual tracing required)")
    for category, pattern in PATTERNS.items():
        print(f"\n## {category}")
        print("\n".join(sorted(candidates(pattern))))
