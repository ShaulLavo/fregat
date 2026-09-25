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

## EXT-18: follow worktree branch drift

A session has no branch of its own here: it points at a worktree, and the worktree's `branch` and
`headCommit` are metadata the server refreshes from the checkout. Turn-end checkpoint capture writes
refs through `GitService`, whose mutation listener refreshes that worktree's metadata, so an agent's
`git checkout -b` in its dedicated worktree becomes the worktree branch when the turn ends. The
refresh command carries `expectedMetadataVersion`, so a stale drift update loses to a concurrent
explicit change. A shared checkout's branch is checkout metadata too; PR association (LIFE-14) is
what uses dedicated worktrees only.

The gap was on the client: a `checkout -b` or a commit writes only under `.git`, which the file
watcher never reports, so the Git pane kept the old branch. `useSessionCheckoutRefresh` invalidates
git queries when the session worktree's branch or HEAD changes in place.

- `apps/server/src/orchestration/tests/worktree-branch-drift.test.ts`: the agent's checkout during a
  turn is the worktree branch at turn end; a shared checkout's switch is recorded as its metadata.
- `scenario session-branch-drift` (native checkpoint fixture, new worktree, `git` edit op):
  `/work/tmp/fregat-evidence/20260925T114547Z-scenario-session-branch-drift/`.

## LIFE-14 (server side): pull request state per session worktree

The shell's worktree carries `pullRequest`: `null` when untracked, `none`, `unknown` (a failed
lookup with nothing known before it, never "no pull request"), `unsupported` with the `gh` reason,
or `found` with number, title, URL, state (`open`, `closed`, `merged`) and `draft`. Only dedicated
worktrees are tracked (platform-owned, linked, with a visible session): a shared checkout's branch
belongs to no one session, which is how upstream's strict branch matching maps here.

`PullRequestSyncReactor` sweeps every minute, and at once when a worktree is created, adopted or
changes branch. It groups due worktrees by project, so a repository costs one `gh api graphql`
request for all its branches (50 aliases per request, branch names passed as variables). Due rules
follow upstream: no answer or `unknown` every sweep; open or none while a session on it is
unsettled every sweep; anything else every 15 minutes; merged never again. A failed lookup backs
that repository off (1 minute doubling to 30) and keeps known answers. The event
`worktree.pull-request-synced` is emitted only when the answer changes, and the decider rejects an
answer for a branch the worktree has left. A branch change clears the answer in the projection.
Migration 25 adds `projection_worktrees.pull_request_json`.

The row badge is lane L5's (LIFE-14 badge); this delivers the field it reads.

- `apps/server/src/orchestration/tests/pull-request-sync.test.ts`: none then found on the shell,
  shared checkout never asked, branch change re-asks for the new branch; unknown on failure,
  backoff, known answer kept; merged is final; unsupported forge.
- `apps/server/src/git/tests/push-and-pull-request.test.ts` (batched lookup): one request for
  three branches, names as variables, failures and malformed responses throw.
- `scenario session-pull-request-sync`: the throwaway server runs with a fake `gh` first on PATH
  (the new `Scenario.prepareServer` hook); a new-worktree session's draft PR reaches the shell and
  the shared checkout is not looked up:
  `/work/tmp/fregat-evidence/20260925T115511Z-scenario-session-pull-request-sync/`.
