#!/bin/bash
set -euo pipefail
export ANTHROPIC_BASE_URL=http://127.0.0.1:8318
agents_file=/work/cli-proxy-api/agents.json
if [[ ! -r "$agents_file" ]] || ! agents=$(cat "$agents_file") || [[ -z "${agents//[[:space:]]/}" ]]; then
  printf 'claude-gpt: agents.json must be readable and contain agent definitions.\n' >&2
  exit 1
fi
exec claude --agents "$agents" "$@"
