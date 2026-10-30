#!/usr/bin/env bash
set -euo pipefail

normalize() {
  jq -S '
    def pins:
      with_entries(
        if (.value | type) == "string" and
          (.value | test("^(github:ShaulLavo/(tree-sitter-x|tree-sitter-md)#|git\\+https://github.com/ShaulLavo/(bash-web|waffle)\\.git#|https://github.com/ShaulLavo/(waffle|bash-web|ghostty-webgpu|singapore|hotkeys|fregat|bubli)/releases/download/)[^[:space:]]+$"))
        then .value = "<owned-package-pin>" else . end);
    def section($name): if has($name) then .[$name] |= pins else . end;
    section("dependencies") | section("devDependencies") | section("peerDependencies") |
    section("optionalDependencies") | section("overrides") |
    if (.workspaces | type) == "object" and (.workspaces | has("catalog")) then .workspaces.catalog |= pins else . end |
    if has("allowScripts") then .allowScripts |= with_entries(
      if (.key | test("^waffle@[0-9]+\\.[0-9]+\\.[0-9]+$")) then .key = "waffle@<pin>" else . end)
    else . end
  '
}

scratch=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/manifest-validation-XXXXXX")
trap 'rm -rf "$scratch"' EXIT
while IFS= read -r -d '' file; do
  [[ "$file" == package.json || "$file" == */package.json ]] || continue
  git show "HEAD:$file" | normalize > "$scratch/before"
  normalize < "$file" > "$scratch/after"
  if ! cmp -s "$scratch/before" "$scratch/after"; then
    echo "::error::Dependency update changed manifest fields beyond version pins: $file" >&2
    exit 1
  fi
done < <(git diff --name-only -z HEAD)
