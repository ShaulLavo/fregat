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

## LIFE-06: server-owned automatic settlement

Settings: `chat.autoSettleAfterDays` (3; 0 turns it off), `chat.autoSettleOnMerge` (on), and
per-project overrides in `chat.projectAutoSettle` whose fields each win on their own. Upstream's
null "never" is 0 here so the row can be a number field.

`SessionSettlementReactor` sweeps every five minutes, after any settings change, and when a
worktree's pull request sync lands. The policy (`utils/auto-settlement.ts`) is ported from upstream
`ThreadSettlementPolicy`: the candidate is not archived, has no settle override (explicit keep-active
counts), no pending approval or input, no queued or running turn, no live background work, and no
effective snooze. An open or `unknown` pull request blocks it. A merged (with the setting on) or
closed pull request whose `closedAt` is not before the last request settles it. Otherwise
inactivity past the configured days settles it. The settled time is the last activity. The sync
now reads `closedAt` for that comparison.

`session.auto-settle` carries the sequence the decision read. On the dispatch queue the engine
refuses it when the session has any later event or live background work, and the decider refuses a
session with a settle override or a blocker. Accepted, it emits the same `session.settled` as a
manual settle, including unpin and unsnooze, so provider release follows unchanged.

- `apps/server/src/orchestration/tests/session-auto-settle.test.ts`: a merge after the request
  settles at the last activity; a merge before the request, or with merge settlement off, does not;
  a decision read before a rename is refused and a current one settles at its time; policy cases
  for days, keep-active, snooze, background work, pending requests, open and unknown pull requests.
- `scenario session-auto-settle` (fake forge reports the worktree's pull request merged): the rail
  moves the session to Settled, settled at its creation time:
  `/work/tmp/fregat-evidence/20260925T120806Z-scenario-session-auto-settle/`.

## EXT-01: five forges

`apps/server/src/git/forges/` holds one provider per upstream forge behind `ForgeProvider`
(support, newest pull request per branch, create), and a registry that picks the forge for a
checkout the way upstream does: `origin` first, then the first remote with a known host, then the
first remote. Host detection is upstream's precedence (Forgejo labels and codeberg.org, GitHub,
GitLab, Azure DevOps, Bitbucket). An unknown host is a self-hosted GitLab when `glab auth status
--hostname` accepts it, or a Forgejo when a `tea` login names it. The pull request state now
carries `forge`, and "no forge" replaces "no GitHub remote".

| Forge           | Boundary                                         | Lookup                                                          | Create                                            |
| --------------- | ------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------- |
| GitHub          | `gh` (`--hostname` / `GH_HOST` when self-hosted) | `pr list` for the header, one GraphQL request for many branches | `pr create` (draft)                               |
| GitLab          | `glab`                                           | `mr list --source-branch` per branch                            | `mr create --yes` (target, draft)                 |
| Forgejo / Gitea | `tea` login for the host + `tea api`             | recent pulls, filtered by head branch                           | `POST pulls`, base defaulting to the repository's |
| Azure DevOps    | `az repos` with `--detect true`                  | `pr list --source-branch` per branch                            | `pr create` (target, draft)                       |
| Bitbucket Cloud | REST 2.0                                         | `pullrequests?q=source.branch.name` per branch                  | `POST pullrequests` (destination, draft)          |

Differences from upstream, each a local rule: Bitbucket authenticates with the credential git
already stores for bitbucket.org (`git credential fill`, never prompting) instead of new
environment variables, because a token may not live in an env var or in settings here. Forgejo
goes through `tea` (upstream's fallback) and not `fj`. Bitbucket Data Center has a different API and
reads as no forge. The web labels GitLab's button "Merge request".

- `apps/server/src/git/tests/forges.test.ts` (34 cases): detection per host and precedence; GitHub
  absence, existing, create after absence, seven failure kinds with no create, missing vs signed-out
  CLI, batched GraphQL, self-hosted host; GitLab list/create and self-hosted recognition; Forgejo
  login matching, filtering and create body; Azure list/URL and signed-out; Bitbucket credential,
  query and refusal; unknown host.
- `scenario git-merge-request` (fake `glab` on the server's PATH): the header offers Merge request
  on a gitlab.com checkout, and creating it shows `#5`:
  `/work/tmp/fregat-evidence/20260925T130215Z-scenario-git-merge-request/`.
