# Worktree lifecycle

A session selects a checkout when it is created. **Send to current branch** uses the draft's
selected worktree. **New worktree** creates a checkout from that worktree's current commit.
The server stores the exact commit before accepting creation. Later changes to the base branch
cannot change the fork point.

The [worktree contracts](../packages/contracts/src/worktree-lifecycle.ts) carry IDs and explicit
intent. The browser supplies neither a checkout path nor a branch name. Managed checkout paths
are `<git-common-dir>/platform-worktrees/<WorktreeId>`, and branches are `worktree/<WorktreeId>`.
The projected `canonicalPath` is absolute; `path` is relative to the server's filesystem root.
Each checkout keeps its own changes, index, and editor buffers.

## Creation and provider execution

Acceptance records the worktree request, session, user message, blocked turn, and receipt in one
transaction. The worktree moves from `provisioning` to `ready` or `creation-failed`. A failed request
keeps the message visible and raises worktree attention. Retry uses a new operation ID with the
same worktree, session, turn, and saved base commit. Stop cancels the blocked turn permanently.

The provider can start only when the projected checkout is ready. It then follows the existing
durable provider claim protocol. Worktree recovery cannot resend a claimed or ambiguous turn.
Result commands compare the current lifecycle and operation ID, so stale results cannot overwrite
a later retry.

[The Git service](../apps/server/src/git/worktrees.ts) creates refs only when absent and verifies
an existing checkout before recovery can adopt it. Mutations use a lane keyed by the canonical
Git common directory. Separate repositories can progress independently.

## Cleanup and ownership

Session deletion stops that session's provider and reclaims its attachments. It never removes a
checkout. The project worktree manager remains reachable after the last session is deleted.
Rows show shared use, lifecycle failures, process ownership, and cleanup eligibility.

Safe cleanup requires Platform ownership, zero non-deleted session references, successful provider
stop evidence, and no terminal or unverified external process ownership. Archived sessions still
count. Attachment reclamation failure does not block an otherwise safe cleanup.

The [execution gate](../apps/server/src/orchestration/worktrees/worktree-execution-gate.ts) gives provider and
terminal processes shared leases. Cleanup takes an exclusive lease and checks the actual services
again before Git removal. A terminal keeps its lease while detached and after disposal is requested.
Only a positive process exit plus an accepted terminal-end receipt releases that lease.
An exited bridge without an acknowledged PTY exit keeps ownership blocked.
Provider adapters also retain failed-stop handles until process exit is acknowledged. Text-only
commit-message generation runs in an isolated temporary directory outside the checkout.

Force cleanup is a separate confirmed command. Its authorization records HEAD and a fingerprint
covering the index, tracked files, untracked files, ignored files, paths, types, modes, and symlink
targets. A change after preview requires renewed confirmation, including after restart. Unreadable
entries and special files cannot be authorized. Force bypasses dirt only.

Cleanup removes the linked checkout and retains the branch and commits. Retain restores an existing
blocked checkout to ready. Release preserves files and transfers cleanup responsibility outside
Platform. Project deletion requires managed checkouts to be removed or explicitly released first.
Release remains available when the repository itself is no longer reachable.

A missing or failed worktree with neither a checkout nor Git administration has a separately
confirmed resolution command. It records removal without deleting files. An unclaimed checkout
must be explicitly adopted before cleanup is available. Adoption saves its observed HEAD as its
initial diff base.

## Recovery and projections

Migration 12 appends lifecycle and terminal lease state to the session domain from migration 11.
It preserves events and receipts. Rebuilding projections from the retained log produces the same
state as migration backfill, including sticky discovered-driver history. WebSocket protocol 6
requires the new creation and shell shapes.

The existing readiness coordinator runs provider and deletion recovery, terminal ownership
reconciliation, worktree provisioning and orphan discovery, cleanup recovery, and eligible blocked
turn release. A terminal claim from an older server epoch becomes unknown ownership unless the
request was never claimed. Unknown ownership permits release and manual cleanup.

Worktree lifecycle changes update every referencing session's attention. Session and terminal
events update the worktree's cleanup eligibility. Transports retain distinct aggregate deltas at
the same event sequence. Reconnect replays the last sequence inclusively so a connection dropped
between related deltas can receive the remaining updates. The row and stage header use the same
worktree chip.

Branch and HEAD metadata refresh at registration, adoption, startup, provider turns, Platform Git
mutations, and explicit status refresh. Versioned metadata commands preserve an `A → B → A`
branch change without duplicate events for an unchanged observation. Managed diffs use the saved
base commit instead of Git config sidecars.

## Verification

[The focused verification script](../scripts/verify-worktree-lifecycle.sh) runs contracts, receipt
and projection checks, real Git recovery tests, terminal lease tests, and the web integration.
It also checks types, lint, formatting, and removal of the old mutation routes.
Run `bash scripts/verify-worktree-lifecycle.sh`, or pass `contracts`, `client-core`, `server`, or
`web` to repeat selected parts.

[Server integration](../apps/server/src/orchestration/tests/worktree-lifecycle.integration.test.ts)
and [web integration](../apps/web/src/features/chat/tests/worktree-lifecycle.integration.test.tsx)
drive the real app with temporary repositories. [Crash recovery tests](../apps/server/src/orchestration/tests/worktree-recovery.test.ts)
exercise accepted intent, created refs, created checkouts, ready projection, authorized cleanup,
and physical removal before completion is recorded.
