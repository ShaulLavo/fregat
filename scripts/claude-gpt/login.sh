#!/bin/bash
set -euo pipefail
umask 077
exec /work/cli-proxy-api/bin/cli-proxy-api -config /work/cli-proxy-api/config.yaml -codex-device-login -no-browser "$@"
