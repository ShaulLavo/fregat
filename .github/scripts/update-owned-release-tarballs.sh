#!/usr/bin/env bash
set -euo pipefail

latest_release_tag() {
  gh api "repos/$1/releases?per_page=100" --paginate \
    --jq ".[] | select(.draft == false) | select(.tag_name | startswith(\"$2\")) | .tag_name" |
    sed -n '1p'
}

update_url() {
  local repository=$1 tag=$2 release=$3 old=$4
  local old_name asset_prefix new_asset new
  old_name=${old##*/}
  asset_prefix=$(printf '%s' "$old_name" | sed -E \
    's/-[0-9a-f]{40}\.tgz$//; s/-[0-9]+\.[0-9]+\.[0-9]+[^/]*\.tgz$//; s/\.tgz$//')
  new_asset=$(jq -r --arg prefix "$asset_prefix" \
    '[.assets[].name | select(. == ($prefix + ".tgz") or test("^" + $prefix + "-([0-9]+\\.[0-9]+\\.[0-9]+[^/]*|[0-9a-f]{40})\\.tgz$"))] | if length == 1 then .[0] else error("Expected one release asset") end' <<< "$release")
  new="https://github.com/${repository}/releases/download/${tag}/${new_asset}"
  [[ "$old" == "$new" ]] && return 0
  OLD_URL="$old" NEW_URL="$new" perl -0pi -e 's/\Q$ENV{OLD_URL}\E/$ENV{NEW_URL}/g' package.json
}

update_repository() {
  local repository=$1 tag release old
  tag=$(latest_release_tag "$repository" "$2")
  test -n "$tag"
  release=$(gh api "repos/${repository}/releases/tags/${tag}")
  while read -r old; do
    update_url "$repository" "$tag" "$release" "$old"
  done < <(grep -oE "https://github.com/${repository}/releases/download/[^\"[:space:]]+\.tgz" package.json | sort -u)
}

update_repository ShaulLavo/ghostty-webgpu v
update_repository ShaulLavo/singapore singapore-
update_repository ShaulLavo/hotkeys hotkeys-
update_repository ShaulLavo/bubli v
runtime=$(git ls-remote https://github.com/ShaulLavo/tree-sitter-x refs/heads/web-tree-sitter | cut -f1)
markdown=$(git ls-remote https://github.com/ShaulLavo/tree-sitter-md HEAD | cut -f1)
[[ "$runtime" =~ ^[0-9a-f]{40}$ && "$markdown" =~ ^[0-9a-f]{40}$ ]]
sed -E -i "s|(github:ShaulLavo/tree-sitter-x#)[0-9a-f]+|\\1${runtime}|g; s|(github:ShaulLavo/tree-sitter-md#)[0-9a-f]+|\\1${markdown}|g" package.json
if ! git diff --quiet -- package.json; then
  bun install --lockfile-only --ignore-scripts
fi
