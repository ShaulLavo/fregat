#!/usr/bin/env bash
# Mirrors this checkout onto the Pi lane: same commit, same uncommitted changes, same built
# workspaces, so the bench's git provenance on the Pi matches the tree it measured here.
# Usage: scripts/heavy/pi/sync.sh [--host pi] [--dir fregat-lane] [--web <built web dir>]
set -euo pipefail

host=pi
dir=fregat-lane
web=
while [ $# -gt 0 ]; do
  case $1 in
    --host) host=$2; shift 2 ;;
    --dir) dir=$2; shift 2 ;;
    --web) web=$2; shift 2 ;;
    *) echo "usage: $0 [--host pi] [--dir fregat-lane] [--web <built web dir>]" >&2; exit 2 ;;
  esac
done

root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$root"
remote=$dir/platform

# Packages resolve through dist/; the Pi builds nothing, so a missing build here fails there later.
if [ ! -f editor/packages/editor/dist/index.js ]; then
  echo "No built workspaces in $root. Run \`bun run build:workspaces\` (through the heavy wrapper) first." >&2
  exit 1
fi

# A ref the Pi's checkout never has checked out, so the push is never refused.
git push --quiet --no-verify --force "$host:$remote" HEAD:refs/heads/lane
commit=$(git rev-parse HEAD)
ssh "$host" "cd $remote && git checkout --quiet --force --detach $commit && git clean -fdq"
git diff --binary HEAD | ssh "$host" "cd $remote && git apply --allow-empty --whitespace=nowarn"
git ls-files -z --others --exclude-standard | rsync -a --from0 --files-from=- ./ "$host:$remote/"

mapfile -d '' builds < <(
  find editor/packages ghostty-webgpu hotkeys/packages -path '*/node_modules' -prune -o -type d -name dist -print0
)
rsync -aR --delete "${builds[@]}" "$host:$remote/"

# Tree-sitter grammar packages build native bindings with no arm64 prebuild; the editor loads wasm.
ssh "$host" "cd $remote && PATH=\$HOME/.local/bin:\$PATH bun install --frozen-lockfile --ignore-scripts >/dev/null"

if [ -n "$web" ]; then
  [ -f "$web/index.html" ] || { echo "No production web build at $web" >&2; exit 1; }
  rsync -a --delete "$web/" "$host:$dir/web/"
fi

dirty=$(git status --porcelain | wc -l)
echo "Synced $commit ($dirty uncommitted paths) to $host:$remote${web:+, web build to $host:$dir/web}"
