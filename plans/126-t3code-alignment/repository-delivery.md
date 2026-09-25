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
