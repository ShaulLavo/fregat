# Repository and worktree delivery (completion wave, lane L9)

Rows close when their `agent:browser` scenario proves the behaviour (completion-wave owner decision).

## EXT-15: submodules in new worktrees

`git.worktreeSubmodules` (machine scope, `recursive` by default, also `top-level` and `none`) and a
per-project override in `git.projectWorktreeSubmodules` keyed by project UUID. The worktree
lifecycle reactor runs `git submodule update --init [--recursive]` after `worktree add` and before
the creation completes, so the first turn sees populated submodules. It runs outside the repository
lane: each worktree clones its submodules over the network, and holding the lane would block every
commit in the repository. A failed clone is logged as `worktree.submodules.failed` and the worktree
is still created.

Git status reports `uninitializedSubmodules` (declared paths with no `.git`), and the Git panel shows
"N submodules are not initialized" with an Initialize action (`POST /git/submodules/init`, the
`init-submodules` mutation). That notice is both the failure report and the retry. An explicit
Initialize runs even when the mode is `none`, as `top-level`.

Upstream's `t3.json` checkout override is not ported: a checked-out file does not choose git flags
here; the project override lives in machine settings.

- `apps/server/src/orchestration/tests/worktree-submodules.test.ts`: recursive default, project
  override over machine default, `none` plus explicit init, failed clone keeps the worktree.
- `scenario git-submodules-init`: `/work/tmp/fregat-evidence/20260925T113220Z-scenario-git-submodules-init/`.

## EXT-14: keep the default branch current

`git.autoPull` (machine scope, off by default, as pinned) with a per-project override in
`git.projectAutoPull`. Only registered project checkouts qualify. A status read evaluates the
checkout after the background upstream fetch has moved its upstream ref; when the checkout is on the
remote's default branch (`<remote>/HEAD`), tracks it, has no local commits and no changed or
untracked files, and is behind, the server runs `git merge --ff-only @{u}` detached. A fast-forward
either moves HEAD or changes nothing, so a failure never leaves a merge in progress; it is shown and
not retried for a minute.

Status carries `autoPull`: `null` when off, `current`, `pulling`, `skipped` with a reason (`changes`,
`ahead`, `diverged`, `detached`, `no-upstream`, `no-default-branch`, `other-branch`) or `failed`. The
Git panel prints one muted line for a skip or a failure. While `pulling`, the client polls status
every 500 ms, because the pull moves HEAD after its file writes already triggered a refetch.

- `apps/server/src/git/tests/auto-pull.test.ts`: fast-forward, policy off, modified and untracked,
  ahead and diverged, detached / other branch / no upstream, failed pull with no partial merge and
  a cooldown, project override.
- `scenario git-auto-pull`: `/work/tmp/fregat-evidence/20260925T113952Z-scenario-git-auto-pull/`.
