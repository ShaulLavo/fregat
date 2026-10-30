#!/usr/bin/env bash
set -euo pipefail
script_root=$(cd -- "$(dirname -- "$0")" && pwd)
scratch=$(mktemp -d "${TMPDIR:-/tmp}/publisher-test-XXXXXX")
trap 'rm -rf "$scratch"' EXIT
export TEST_ROOT="$scratch"
mkdir "$scratch/bin" "$scratch/artifact"
git init --bare -q "$scratch/remote.git"
git init -q -b main "$scratch/consumer"
cd "$scratch/consumer"
git config user.name test
git config user.email test@example.com
git config core.hooksPath /dev/null
git config core.filemode true
mkdir -p .github/scripts
cp "$script_root/publish-update.sh" "$script_root/check-update-paths.sh" "$script_root/check-manifests.sh" .github/scripts/
printf '{"dependencies":{"waffle":"https://github.com/ShaulLavo/waffle/releases/download/waffle-v0.0.1/waffle-0.0.1.tgz"}}\n' > package.json
cp package.json manifest-fixture.json
printf '{}\n' > bun.lock
git add .
git commit -qm base
base=$(git rev-parse HEAD)
git remote add origin "$scratch/remote.git"
git push -q origin main
printf '{"dependencies":{"waffle":"https://github.com/ShaulLavo/waffle/releases/download/waffle-v0.0.2/waffle-0.0.2.tgz"}}\n' > package.json
git diff > "$scratch/artifact/update.patch"
git restore -- package.json
cat > "$scratch/bin/gh" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$TEST_ROOT/gh-calls"
case "$1 $2" in
  'api repos/'*) git --git-dir="$TEST_ROOT/remote.git" rev-parse refs/heads/automation/test ;;
  'pr list') if [[ -f "$TEST_ROOT/pr" ]]; then echo 123; fi ;;
  'pr create') touch "$TEST_ROOT/pr" ;;
  'pr edit') test -f "$TEST_ROOT/pr" ;;
  'run list')
    current=$(git --git-dir="$TEST_ROOT/remote.git" rev-parse refs/heads/automation/test)
    if [[ -f "$TEST_ROOT/ci-head" ]] && [[ "$current" == "$(cat "$TEST_ROOT/ci-head")" ]]; then
      echo '{"status":"completed","conclusion":"success"}'
    fi ;;
  'workflow run') git --git-dir="$TEST_ROOT/remote.git" rev-parse refs/heads/automation/test > "$TEST_ROOT/ci-head" ;;
  *) echo "Unexpected gh call: $*" >&2; exit 1 ;;
esac
MOCK
chmod +x "$scratch/bin/gh"
export PATH="$scratch/bin:$PATH" BRANCH=automation/test GH_TOKEN=fixture GITHUB_REPOSITORY=ShaulLavo/fixture TITLE='Update fixture pins' RUNNER_TEMP="$scratch" UPDATE_ARTIFACT="$scratch/artifact"
bash .github/scripts/publish-update.sh
first=$(git --git-dir="$scratch/remote.git" rev-parse refs/heads/automation/test)
git switch -q --detach "$base"
bash .github/scripts/publish-update.sh
second=$(git --git-dir="$scratch/remote.git" rev-parse refs/heads/automation/test)
test "$first" = "$second"
git restore --staged --worktree -- package.json
printf '{"dependencies":{"waffle":"https://github.com/ShaulLavo/waffle/releases/download/waffle-v0.0.3/waffle-0.0.3.tgz"}}\n' > package.json
git diff > "$scratch/artifact/update.patch"
git restore -- package.json
bash .github/scripts/publish-update.sh
third=$(git --git-dir="$scratch/remote.git" rev-parse refs/heads/automation/test)
test "$third" != "$first"
test "$(grep -c '^pr create ' "$scratch/gh-calls")" = 1
test "$(grep -c '^pr edit ' "$scratch/gh-calls")" = 2
test "$(grep -c '^workflow run ' "$scratch/gh-calls")" = 2

rejection_failures=0
expect_record_rejection() {
  local label=$1 diagnostic=$2
  local before calls
  before=$(git rev-parse HEAD)
  calls=$(wc -l < "$scratch/gh-calls")
  if bash .github/scripts/publish-update.sh > "$scratch/rejected-record.log" 2>&1; then
    echo "FAIL: $label was published" >&2
    rejection_failures=$((rejection_failures + 1))
    return
  fi
  grep -q "$diagnostic" "$scratch/rejected-record.log"
  git diff --cached --quiet
  test "$(git rev-parse HEAD)" = "$before"
  test "$(git --git-dir="$scratch/remote.git" rev-parse refs/heads/automation/test)" = "$third"
  test "$(wc -l < "$scratch/gh-calls")" = "$calls"
  git restore -- package.json bun.lock
  echo "Rejected $label before publication."
}

# Every case starts from the trusted base and exercises the full publisher.
git switch -q --detach "$base"
rm bun.lock
git diff --binary > "$scratch/artifact/update.patch"
git restore -- bun.lock
expect_record_rejection 'lockfile deletion' 'must remain regular files'

git switch -q --detach "$base"
rm package.json
ln -s manifest-fixture.json package.json
git diff --binary > "$scratch/artifact/update.patch"
git restore -- package.json
expect_record_rejection 'manifest symlink' 'must remain regular files'

git switch -q --detach "$base"
rm bun.lock
ln -s manifest-fixture.json bun.lock
git diff --binary > "$scratch/artifact/update.patch"
git restore -- bun.lock
expect_record_rejection 'lockfile symlink' 'must remain regular files'

git switch -q --detach "$base"
chmod +x package.json
git diff --binary > "$scratch/artifact/update.patch"
git restore -- package.json
expect_record_rejection 'record mode change' 'changed a record mode'

git switch -q --detach "$base"
if [[ "$rejection_failures" != 0 ]]; then
  echo "$rejection_failures record-boundary regressions failed." >&2
  exit 1
fi
git switch -q --detach "$base"
printf '{"scripts":{"postinstall":"unrelated"}}\n' > package.json
git diff > "$scratch/artifact/update.patch"
git restore -- package.json
if bash .github/scripts/publish-update.sh; then echo 'Manifest code change was accepted' >&2; exit 1; fi
git restore -- package.json
# An allowed manifest filename must still exist on the trusted base.
git switch -q --detach "$base"
mkdir -p packages/new-workspace
printf '{"name":"new-workspace"}\n' > packages/new-workspace/package.json
git add --intent-to-add packages/new-workspace/package.json
git diff > "$scratch/artifact/update.patch"
git reset -q -- packages/new-workspace/package.json
rm packages/new-workspace/package.json
if bash .github/scripts/publish-update.sh; then echo 'New manifest was accepted' >&2; exit 1; fi
# A patch outside the pin allowlist must stop before publication.
git switch -q --detach "$base"
printf 'forbidden\n' > .github/scripts/publish-update.sh
git diff > "$scratch/artifact/update.patch"
git restore -- .github/scripts/publish-update.sh
if bash .github/scripts/publish-update.sh; then echo 'Forbidden patch was accepted' >&2; exit 1; fi
test "$(git --git-dir="$scratch/remote.git" rev-parse refs/heads/automation/test)" = "$third"
echo 'Publisher fixtures passed: PR reuse, CI dispatch, pin-only edits, and regular record preservation.'
