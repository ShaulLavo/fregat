#!/usr/bin/env bash
set -euo pipefail

# The write-token job executes only this script from the workflow's original main commit.
bash .github/scripts/check-update-paths.sh "$UPDATE_ARTIFACT/update.patch"
git apply --check "$UPDATE_ARTIFACT/update.patch"
git apply "$UPDATE_ARTIFACT/update.patch"
bash .github/scripts/check-update-paths.sh
bash .github/scripts/check-manifests.sh
git add --all
tree=$(git write-tree)
git fetch origin "refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" 2>/dev/null || {
  # An absent branch is the normal first run. Other fetch failures must stop publication.
  if git ls-remote --exit-code origin "refs/heads/$BRANCH"; then exit 1; else test "$?" = 2; fi
}
old=$(git rev-parse --verify "refs/remotes/origin/$BRANCH" 2>/dev/null || true)
if [[ -z "$old" ]] || [[ "$tree" != "$(git rev-parse "$old^{tree}")" ]]; then
  git config user.name 'github-actions[bot]'
  git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
  git commit -m "$TITLE"
  auth=$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)
  echo "::add-mask::$auth"
  git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $auth" \
    push --force-with-lease="refs/heads/$BRANCH:$old" origin "HEAD:refs/heads/$BRANCH"
fi
# Read the published tip because unchanged updates keep their previous commit.
head=$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/$BRANCH" --jq '.object.sha')
body="$RUNNER_TEMP/dependency-update.md"
cat > "$body" <<MARKDOWN
## Quick summary
This PR updates our package pins and their generated lock and source records to the newest upstream versions.

The scheduled dependency workflow refreshes this same branch when more versions arrive. CI is dispatched explicitly because PRs created with the built-in token do not start PR workflows.
MARKDOWN
pr=$(gh pr list --repo "$GITHUB_REPOSITORY" --head "$BRANCH" --base main --state open --json number --jq '.[0].number // empty')
if [[ -n "$pr" ]]; then
  gh pr edit "$pr" --repo "$GITHUB_REPOSITORY" --title "$TITLE" --body-file "$body"
else
  gh pr create --repo "$GITHUB_REPOSITORY" --head "$BRANCH" --base main --title "$TITLE" --body-file "$body"
fi
run=$(gh run list --repo "$GITHUB_REPOSITORY" --workflow ci.yml --branch "$BRANCH" --commit "$head" \
  --event workflow_dispatch --limit 1 --json status,conclusion --jq '.[0] // empty')
if [[ -z "$run" ]] || jq -e '.status == "completed" and .conclusion != "success"' <<< "$run" >/dev/null; then
  gh workflow run ci.yml --repo "$GITHUB_REPOSITORY" --ref "$BRANCH"
fi
