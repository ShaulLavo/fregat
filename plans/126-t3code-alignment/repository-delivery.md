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

## EXT-03: clone and repository publication

**Clone.** The palette's `Clone repository…` opens a dialog: a URL or `owner/name` (GitHub
shorthand, as upstream reads a pasted name) and a folder, which defaults to a sibling of the open
workspace named after the repository. `POST /git/clone-stream` runs `git clone --progress` and
streams upstream's stages (connecting, counting, receiving, resolving, checkout) with percentages;
the dialog shows them. The destination must be new or an empty folder, and a folder with files is
refused untouched. Closing the stream cancels: git is stopped and everything it wrote is removed,
keeping an empty folder the user chose. A failed clone reports git's last lines, credentials
redacted, and leaves nothing. Only a finished checkout is registered as a project, so a cancelled or
failed clone never becomes a half-created one; the app then opens it. Retry is cloning again.
Upstream registers the project before git runs and tracks clones server-side with toasts; here the
dialog owns the stream, which gives the same cancel and no-half-project outcomes.

**Publish.** A repository with no remote shows `Publish repository` in the Git pane and the session
header. The dialog takes the forge, `owner/name` (Azure: `organization/project/name`), an optional
host, visibility and SSH or HTTPS. The server checks the forge CLI is ready, creates the repository
with the provider (`gh repo create`, GitLab `POST projects` with the namespace id, Forgejo `POST
user/repos` or `orgs/{owner}/repos`, `az repos create`, Bitbucket `POST repositories`), adds it as
`origin` (reusing a remote with the same URL, `origin-1` when the name is taken), and pushes the
branch with upstream tracking when there is a commit. The outcome is `pushed`, `remote-added`
(nothing to push yet) or `push-failed` (the repository exists and the push did not land), each with
its own toast. `hasRemote` joins the branch remote state; listing remotes is a read-only git call.

- `apps/server/src/git/tests/clone.test.ts`: success registers, non-empty folder refused and kept,
  failure leaves nothing and registers nothing, cancel removes what was written.
- `apps/server/src/git/tests/publish.test.ts`: pushed (branch reaches the remote, upstream set),
  remote-added, push-failed keeping the remote, forge signed out creates nothing, `origin-1`.
- `apps/server/src/git/tests/forges.test.ts`: repository creation for GitLab, Forgejo, Azure DevOps
  (name shape refused) and Bitbucket.
- `scenario git-clone-publish`: `/work/tmp/fregat-evidence/20260925T131311Z-scenario-git-clone-publish/`.

## EXT-04: project scripts and worktree setup

Trust model (D8, the plan's recommendation): a checked-out file never runs anything. The palette's
script mode lists a repository's `t3.json` scripts under "From t3.json" with an `Import scripts from
t3.json` row; importing copies them into the project's saved scripts, mapping upstream's fields
(`runOnWorktreeCreate`, and `async: false` on such a script to `waitForSetup`). Scripts already
saved by command or name are skipped. Only saved scripts run on worktree creation, so a later edit
of the file changes nothing until it is imported again. Running a file script from the palette
saves its name and command, never its setup flags.

The first saved script with `runOnWorktreeCreate` is the setup script. When the lifecycle reactor
creates a session worktree it runs it after submodules, as a process the server owns in the new
worktree (`PLATFORM_WORKTREE_PATH`, `PLATFORM_PROJECT_ROOT`, and upstream's `T3CODE_*` names),
in its own process group so a stop reaches everything it started. With `waitForSetup` it runs
before the worktree is ready, so the first turn waits; a failure or stop fails the creation
(`worktree.SETUP_FAILED` / `SETUP_CANCELLED`), which holds the turn and offers the existing Retry,
and a retry reruns it once. Without it the worktree is ready at once and the setup runs beside the
first turn. The worktree carries `setup` (name, foreground, state, exit code, last 40 lines); the
worktree manager shows it with Stop setup and Run setup (`worktree.setup.cancel` / `.run`), and the
chip names a running or failed setup. Removing a worktree stops its setup first; shutdown stops all.
Migration 26 adds `projection_worktrees.setup_json`. The terminal service is lane L4's and Plan
149 rewrites it, so setup runs as a supervised process; upstream runs it in a terminal.

- `apps/server/src/orchestration/tests/worktree-setup.test.ts`: foreground runs in the worktree
  before the first turn; failure holds the turn and retry runs it once more; background lets the
  turn start and can be stopped and rerun; no setup script runs nothing and refuses a rerun.
- `apps/web/src/features/chat-mode/utils/tests/project-scripts.test.ts`: t3.json mapping, skipping
  malformed entries; import filter by command and name.
- `scenario worktree-setup-import`: `/work/tmp/fregat-evidence/20260925T132239Z-scenario-worktree-setup-import/`.

## EXT-02: start from a pull request, composed push and open (partial)

Builds on lane L8's Plan 139 research (94d04d71). **Reference.** `parsePullRequestReference` in
contracts reads GitHub, GitLab, Forgejo, Azure DevOps and Bitbucket pull request URLs, `#123`, a
bare number, and the `gh`/`glab`/`tea`/`az` checkout commands, like upstream's
`pullRequestReference.ts`.

**Start from a pull request.** The palette's `Start session from pull request…` takes a reference
for the open checkout. `POST /orchestration/pull-request-session` resolves it on the checkout's
forge (each provider's `getPullRequest`: head and base branch, fork or not, and the ref the forge
publishes the head under: `refs/pull/N/head`, `refs/merge-requests/N/head`, or the source branch
on Azure and Bitbucket), fetches that head into `pr/N`, and creates a session titled `#N title` in
a new worktree based on it, through the ordinary lifecycle (submodules, setup). A same-repository
pull request's worktree then tracks the remote head branch, so pushes land on the pull request and
the sync reactor finds it by that branch name; a fork's head stays fetch-only. Upstream prepares a
thread in local or worktree mode; here it is always a worktree, the session model's isolation.

**Composed push and open.** A branch with commits to send and no pull request shows `Push and open
pull request` (GitLab: merge request). `POST /git/push-and-pull-request` pushes, then creates or
reuses the request, and reports each step: a failed push asks nothing of the forge, a pushed
branch whose request failed says so, never full success. Pushes and request lookups use the
upstream branch's name when a worktree tracks one.

**Deferred:** forge comments, replies, viewed files and review submission build on L8's Plan 139
P3 review draft (50cd8c20) and Plan 169's review mode, and land after L8 merges (L8 → L9 → L5).

- `packages/contracts/src/tests/pull-request-reference.test.ts`: every URL shape, `#N`, checkout
  commands, rejections.
- `apps/server/src/orchestration/tests/pull-request-session.test.ts`: URL flow fetches the head,
  tracks the branch and pushes to it; a fork does not track; an invalid reference; push-and-open
  outcomes (push failed, pushed and created, pushed and existing).
- `scenario session-pull-request-start`: `/work/tmp/fregat-evidence/20260925T134337Z-scenario-session-pull-request-start/`.
- `scenario git-merge-request` (now drives Push and open): `/work/tmp/fregat-evidence/20260925T134315Z-scenario-git-merge-request/`.

## EXT-12 with the LIFE-12 cleanup: remove a worktree after its last session is deleted (partial)

Decided 2026-09-25: recommendation (completion wave), through the owned removal lifecycle only.
Deleting a session whose worktree nothing else uses offers **Also remove its worktree** in the
delete dialog (LIFE-12's inline decision). `session.delete` carries `removeWorktree`, recorded on
the `session.deleted` event. `git.worktreeCleanupOnDelete` (machine scope, off by default; per
project in `git.projectWorktreeCleanupOnDelete`) does the same for every deletion, and the dialog
then says so. A worktree another session still uses, archived included, says it stays.

`WorktreeCleanupReactor` sweeps on deletion events, settings changes and hourly. A worktree
qualifies when it is platform-owned and ready, every session that used it is deleted with its
provider stopped, it has no active terminal, and the last deletion asked or the setting says so.
Before asking, git must show no changes, the worktree's own branch checked out, and no ignored
files other than `node_modules`; the read model and setting are read again after those git calls,
so a new session or a switched-off setting keeps it. The reactor only dispatches
`worktree.cleanup` with a key per deletion: the decider refuses a referenced worktree, and the
lifecycle reactor's safe removal refuses a dirty one and stops a running setup. The branch stays.
Safe removal now ignores ignored files under `node_modules`, upstream's one exception, for
manual removal too.

**Not done:** upstream's age, merge and unchanged rules remove the checkout of an idle thread and
recreate it from the branch when the thread resumes. Here a live session's worktree cannot be
removed, so those rules need a restore-on-resume lifecycle step first. Log retention has no
owner (Plan 147 puts it out of scope), and browser artifact retention waits on EXT-07.

- `apps/server/src/orchestration/tests/worktree-cleanup.test.ts`: the request removes it and keeps
  the branch; no request and no setting keeps it; the project setting removes it; a changed file,
  an ignored file or another branch keeps it; `node_modules` does not; an archived session on the
  same worktree keeps it.
- `scenario worktree-cleanup-on-delete`: `/work/tmp/fregat-evidence/20260925T135431Z-scenario-worktree-cleanup-on-delete/`.
