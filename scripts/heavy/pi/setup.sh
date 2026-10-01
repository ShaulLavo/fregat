#!/usr/bin/env bash
# Provisions the Raspberry Pi lane from this machine. Safe to rerun: each step checks first.
# Usage: scripts/heavy/pi/setup.sh [--host pi] [--dir fregat-lane] [--enable-cgroups]
#   --host            ssh alias and mesh host name of the Pi
#   --dir             lane directory under the Pi user's home
#   --enable-cgroups  turn on the memory cgroup and PSI in the boot cmdline and reboot when missing
set -euo pipefail

host=pi
dir=fregat-lane
enable_cgroups=0
while [ $# -gt 0 ]; do
  case $1 in
    --host) host=$2; shift 2 ;;
    --dir) dir=$2; shift 2 ;;
    --enable-cgroups) enable_cgroups=1; shift ;;
    *) echo "usage: $0 [--host pi] [--dir fregat-lane] [--enable-cgroups]" >&2; exit 2 ;;
  esac
done

here=$(dirname "$0")
root=$(git -C "$here" rev-parse --show-toplevel)
bun_version=$(sed -n 's/.*"packageManager": "bun@\([^"]*\)".*/\1/p' "$root/package.json")
origin=$(git -C "$root" remote get-url origin)

step() { printf '[pi-lane] %s\n' "$*"; }

if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$host" true; then
  echo "ssh $host failed. Add a \`Host $host\` block with the Pi's tailnet address, \`User pi\` and the key the Pi authorizes (README.md)." >&2
  exit 1
fi

if ! timeout 60 mesh "$host" -- true </dev/null >/dev/null 2>&1; then
  step "adopting $host into mesh"
  mesh add "$host" --alias "$host" </dev/null
fi

# The Raspberry Pi kernel boots with cgroup_disable=memory and without PSI; without them a
# MemoryMax cap is silently ignored and pressure admission has nothing to read.
if ! ssh "$host" 'grep -qw memory /sys/fs/cgroup/cgroup.controllers && test -e /proc/pressure/memory'; then
  if [ "$enable_cgroups" != 1 ]; then
    echo "$host lacks the memory cgroup or PSI; rerun with --enable-cgroups to fix the boot cmdline and reboot." >&2
    exit 1
  fi
  step "enabling the memory cgroup and PSI on $host, then rebooting"
  ssh "$host" 'set -e
    f=/boot/firmware/cmdline.txt
    [ -e "$f.before-lane" ] || sudo -n cp -p "$f" "$f.before-lane"
    grep -qw cgroup_enable=memory "$f" || sudo -n sed -i "1 s/\$/ cgroup_enable=memory psi=1/" "$f"
    sync
    sudo -n systemctl reboot' || true
  sleep 20
  for _ in $(seq 60); do
    ssh -o BatchMode=yes -o ConnectTimeout=5 "$host" true 2>/dev/null && break
    sleep 5
  done
  ssh "$host" 'grep -qw memory /sys/fs/cgroup/cgroup.controllers && test -e /proc/pressure/memory' || {
    echo "$host came back without the memory cgroup or PSI; check /boot/firmware/cmdline.txt" >&2
    exit 1
  }
fi

step "packages, Bun $bun_version and the checkout on $host"
ssh "$host" bash -s -- "$bun_version" "$dir" "$origin" <<'REMOTE'
set -euo pipefail
bun_version=$1 dir=$2 origin=$3
command -v git >/dev/null || sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y -q git rsync >/dev/null
if [ "$("$HOME/.bun/bin/bun" --version 2>/dev/null)" != "$bun_version" ]; then
  curl -fsSL https://bun.sh/install | bash -s "bun-v$bun_version" >/dev/null
fi
mkdir -p "$HOME/.local/bin" "$HOME/$dir/runs"
ln -sf "$HOME/.bun/bin/bun" "$HOME/.local/bin/bun"
ln -sf "$HOME/.bun/bin/bun" "$HOME/.local/bin/bunx"
[ -d "$HOME/$dir/platform/.git" ] || git clone --quiet "$origin" "$HOME/$dir/platform"
REMOTE

step "syncing this checkout"
"$here/sync.sh" --host "$host" --dir "$dir"

step "Playwright Chromium and its system libraries on $host"
ssh "$host" "cd $dir/platform && PATH=\$HOME/.local/bin:\$PATH bunx playwright install --with-deps chromium >/dev/null"

ssh "$host" 'printf "[pi-lane] ready: %s, %s, %s CPU, %s MiB, Bun %s\n" "$(tr -d "\0" </proc/device-tree/model)" "$(uname -m)" "$(nproc)" "$(($(sed -n "s/MemTotal: *\([0-9]*\).*/\1/p" /proc/meminfo) / 1024))" "$($HOME/.local/bin/bun --version)"'
