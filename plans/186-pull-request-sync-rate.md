# Plan 186: PR sync: an off switch and a smarter poll rate

## Status and authorization

- Status: PROPOSED 2026-09-26, ready. Follow-up to Plan 126 LIFE-14 (lane L9), from the
  2026-09-26 direction audit, item 3.
- Decided 2026-09-26: owner — "PR poller (L9, LIFE-14): add an off switch (a setting) and a
  smarter poll rate. Poll only worktrees with an open or unknown PR, back off when idle or hidden,
  stop on merged/closed, and respect forge rate-limit headers." Five forges stay (owner, same day).
- Effort: M, in slices that land on their own.

## Today

`PullRequestSyncReactor` (`apps/server/src/orchestration/pull-request-sync-reactor.ts`) sweeps
every 60 s with no setting. Due rules: no answer or `unknown` every sweep; `none` or open while a
session on the worktree is unsettled every sweep; everything else every 15 min; merged never. A
failed lookup backs its project off (1 min doubling to 30). Rate limits are recognised only from
CLI stderr (`git/forges/cli.ts:62`). Record: [repository delivery, LIFE-14](126-t3code-alignment/repository-delivery.md).

## Outcome

The sync can be turned off, and when it is on it calls a forge only for a worktree whose answer can
still change, less often when nobody is working or looking, and never past the forge's own limit.

## Scope

1. **Off switch.** A registry key (proposed `git.pullRequestSync`, boolean, default on, `machine`
   scope: it gates forge CLI runs on the server's machine). Off: no sweep and no event-triggered
   lookup; rows keep the last known answer. Turning it on sweeps once at once.
2. **Only open or unknown.** The periodic due set is worktrees with no answer, `unknown`, or an
   open (including draft) PR. `none` is asked on events only: worktree created or adopted, branch
   change, a push or "Push and open pull request" from the app, and a turn ending in that worktree.
3. **Stop on merged or closed.** Both are final, as merged is today. A branch change or a push
   re-asks.
4. **Back off when idle or hidden.** The interval grows with time since the worktree's last
   activity (turn, push, branch change), up to a cap. While no client is visible (the Plan 142
   presence heartbeat), sweeps pause; the first visible client triggers one sweep.
5. **Forge rate-limit headers.** Read `Retry-After` and the remaining/reset headers wherever the
   transport exposes them (`gh api --include`, `glab api --include`, Bitbucket's `fetch`, and
   `tea`/`az` if they can), and hold that forge's host until reset. Where no header is available,
   today's stderr detection and backoff stay. All five forges keep working.
6. **One wide event per sweep** with the forge calls made, skipped counts by reason (off, final,
   idle, hidden, rate-limited) and the next due time, so the poll rate is visible in the log.

## Verification

- `apps/server/src/orchestration/tests/pull-request-sync.test.ts` with a fake clock: off makes no
  call; `none`, merged and closed are not polled; idle intervals grow; no visible client pauses;
  a `Retry-After` or zero-remaining response holds the host until reset.
- `apps/server/src/git/tests/forges.test.ts`: header parsing per forge from recorded CLI output.
- `scenario session-pull-request-sync` re-run; forge call counts over an idle, hidden 10 min
  window from `bun run logs`, before and after.
- `bun run settings:reference` after registering the key; `bun run gates`.
