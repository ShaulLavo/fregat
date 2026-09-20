# Git

Status, stage and unstage, commit, push, pull, fetch, sync, pull request creation, and file diff views.

## Sub-features

Status list with tree dots, stage/unstage single and many, discard, commit with generated message, remote actions, compare with saved.

## How to get to it (user POV)

The Git side panel. Diff opens as an editor tab.

## Driving it with agent:browser

`bun run agent:browser scenario git-history` checks Changes collapse/reopen across refresh, Graph tab restoration, the selected commit, disclosure state, full-history search filtering and search restoration. It also measures commit-dot width and height in the sidebar and expanded graph, expands the graph, loads older commits, restores pages and scroll after refresh, searches an older commit by hash, clears search, restores a branch filter, and opens/reloads a historical file diff. Use a repository with commits that change files; 200+ commits exercises pagination and older-commit search.

Every git action is a `useMutation` with a key under `['git', 'mutation', ...]`; `caches` lists them with status while they run. History POST is a read through an infinite query. A mutation proof reads `git status --porcelain` in the workspace after the action.

## Gotchas

Commit runs hooks; a hook rejection is an expected outcome, not a transport fault. Stage and unstage are not optimistic on purpose.

Graph roots exclude `refs/platform/*`. A browsing session pins tips and ref labels until refresh. Merge file lists compare the first parent. History ends at shallow-clone boundaries. Search matches messages and authors case-insensitively as literal text, or a unique commit-ID prefix, across the full selected history. Filtered results omit ancestry lines. Branch/search selection, commit preview, expanded view, pages, scroll positions, and disclosure choices persist with the workspace. Historical diff URLs carry the explicit `historical` source and immutable blob IDs.

`git-history-search-no-flicker` types a commit search one key at a time and samples every frame. The step label must read `blank-frames-0`: the previous rows stay up until the new ones arrive, and the footer loader is the only sign of the wait.

`git-commit-hook-colors` commits in a fixture repository whose rejecting `pre-commit` hook prints truecolor, 16-color and 256-table SGR. The Commit output log must show no escape text and the colored spans must carry a computed color. The hook exits 1, so nothing is committed.

`git-commit-message-persists` types a commit message in a fixture repository, reloads the window and requires the same text back. The draft is stored per repository location and cleared by a successful commit.
