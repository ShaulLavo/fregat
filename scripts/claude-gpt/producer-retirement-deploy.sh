#!/bin/bash
set -euo pipefail
umask 077
[[ "$#" == 2 ]] || { printf 'Usage: %s SOURCE_DIRECTORY INSTALL_DIRECTORY\n' "$0" >&2; exit 1; }
source_dir=$(cd -- "$1" && pwd)
root=$(cd -- "$2" && pwd)
[[ -f "$source_dir/run.ts" ]] || { printf 'Expected retained run.ts source.\n' >&2; exit 1; }
exec 9>"$root/.gateway-deploy.lock"
flock -n 9 || { printf 'Another gateway deployment is running.\n' >&2; exit 1; }
[[ -f "$root/gateway.js" && ! -L "$root/gateway.js" ]] || {
  printf 'Expected an installed regular gateway.js.\n' >&2
  exit 1
}
staging=$(mktemp -d "$root/.gateway-build-XXXXXX")
next="$root/.gateway-next-$$"
cleanup() { rm -rf -- "$staging"; rm -f -- "$next"; }
trap cleanup EXIT
bun build "$source_dir/run.ts" --target bun --outfile "$staging/gateway.js"
backup=$(mktemp -d "$root/gateway-backup-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
cp -p -- "$root/gateway.js" "$backup/gateway.js"
printf 'Gateway backup saved in %s\n' "$backup"
health() {
  local attempt
  for ((attempt=1; attempt<=30; attempt++)); do
    if curl --disable --noproxy '*' --proxy '' --fail --silent --max-time 3 http://127.0.0.1:8318/health |
      bun -e 'try { const v = JSON.parse(await Bun.stdin.text()); process.exit(v.status === "ready" ? 0 : 1) } catch { process.exit(1) }'; then
      return 0
    fi
    if ((attempt < 30)); then sleep 3; fi
  done
  return 1
}
rollback() {
  trap - ERR
  # Recovery must finish if shutdown sends another signal during restoration.
  trap '' HUP INT TERM
  printf 'Restoring gateway backup.\n' >&2
  cp -p -- "$backup/gateway.js" "$next" && mv -f -- "$next" "$root/gateway.js" || {
    printf 'Gateway restore failed. Backup remains in %s\n' "$backup" >&2
    exit 2
  }
  if mesh serve stop /ai && health; then
    printf 'Previous gateway is healthy. Deployment failed.\n' >&2
    exit 1
  fi
  printf 'Gateway restored. Recovery health failed; inspect /ai.\n' >&2
  exit 2
}
install -m 0644 -- "$staging/gateway.js" "$next"
# Arm rollback before replacing the bundle so signals during replacement recover it too.
trap rollback ERR HUP INT TERM
mv -f -- "$next" "$root/gateway.js"
mesh serve stop /ai
health
trap - ERR HUP INT TERM
printf 'Gateway is healthy.\n'
