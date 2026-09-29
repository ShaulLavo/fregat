#!/bin/bash
set -euo pipefail
export ANTHROPIC_BASE_URL=http://127.0.0.1:8318
exec claude --agents "$(cat /work/cli-proxy-api/agents.json)" "$@"
