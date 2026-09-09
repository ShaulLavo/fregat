# Session domain

Projects identify repositories. Worktrees identify registered checkouts on one environment. Sessions
belong to a worktree and keep the same raw UUID when Claude opens or resumes the conversation.
The server owns this chain in [the contracts](../packages/contracts/src/orchestration-snapshots.ts)
and [the database schema](../apps/server/src/db/schema.ts).

## Registration and paths

[Registration](../apps/server/src/orchestration/registration.ts) resolves filesystem input before
committing a project or worktree. Repository identity uses a normalized origin remote, then a
reachable root commit. A non-Git directory uses its canonical path. SHA-256 repository keys and
separate UUIDv5 namespaces make repository IDs repeat across environments while checkout IDs
include the canonical checkout path. [Independent vectors](../apps/server/src/orchestration/tests/repository-identity.test.ts)
lock those identities.

`Worktree.canonicalPath` is the absolute physical checkout path. `Worktree.path` is relative to the
environment's filesystem root; `''` names that root. File API calls use `path`. Provider and terminal
execution use `canonicalPath`. Projects and sessions carry neither a working directory nor a branch.
Each live project has exactly one protected current worktree.

Public `project.create` commands contain registration input. Their durable receipts return
`{ projectId, worktreeId, disposition }`. The engine checks an existing receipt before resolving the
filesystem. A retry with different intent and the same command ID fails. These behaviors are covered
by [registration tests](../apps/server/src/orchestration/tests/registration.test.ts).

## Runtime and recovery

[The engine](../apps/server/src/orchestration/engine.ts) exposes a `ready` promise. Migration, all
projection replay pages, read-model loading, stale-runtime recovery, and deletion recovery finish
before commands, snapshots, replay, or subscriptions proceed. Discovery starts after readiness and
adds ordinary domain events without delaying the first snapshot.

A provider start advances through `queued → claimed → adopted → settled`. The claim commits before
SDK side effects. Startup may send an unclaimed queued prompt. A claimed or adopted prompt is
ambiguous after a crash and becomes interrupted without an automatic resend. Recovery command IDs
include the observed sequence and runtime epoch. Provider events from an old epoch cannot update
a later run. [Recovery tests](../apps/server/src/orchestration/tests/recovery.test.ts) drive the real
engine and production mock adapter. User Stop settles the turn without an error badge;
only crash recovery records an interruption that needs acknowledgement.

Runtime mode and model preferences apply at the next turn. Reusing a live runtime requires the
same launch configuration; a replacement gets a new epoch. The command queue checks provider event
ownership again at commit time. [Replacement tests](../apps/server/src/orchestration/tests/runtime-replacement.test.ts)
and [epoch race tests](../apps/server/src/orchestration/tests/provider-runtime-epoch.test.ts) cover
configuration changes and callbacks that arrive during a later run.

Session deletion records provider-stop and attachment-cleanup outcomes separately. Failed cleanup
is retried during startup. Project deletion retires its registrations and deletes its sessions;
it preserves physical checkout files. Revival waits for provider ownership to be released. See
[deletion recovery tests](../apps/server/src/orchestration/tests/session-deletion.test.ts).

Migration 11 established the session domain and reset obsolete orchestration state. Migration 12
adds the [worktree lifecycle](worktree-lifecycle.md) while preserving version-11 events and receipts.
[Migration tests](../apps/server/src/db/tests/migrations.test.ts) cover fresh databases, backfill,
projection replay, and repeated application.

## Discovery and attention

Chat settings expose an explicit import action for each enabled Claude Code or Codex provider.
Import includes conversation text for registered projects on the selected machine. It excludes
tool activity and attachments. Claude reads local CLI transcripts through the SDK in an isolated
Bun child with the provider instance's environment. Codex reads local CLI, IDE, and app-server
sessions through `thread/list` and `thread/read`, without resuming them. App sessions must exist in
that provider's local Codex home. Claude app chats and cloud-only conversations are outside this import.

`chat.keepImportedSessionsUpdated` defaults to true. The
[reconciler](../apps/server/src/orchestration/session-discovery.ts) checks previously imported chats
on startup and every minute. It never adds new chats in the background. Unchanged source metadata
skips transcript reads. Sending the first Platform message stops external updates, including after
a checkpoint rollback. The composer notice explains this handoff. Continuing uses the original
provider session; it does not create an independent provider-side copy.

The internal `session.history.import` command stores a `session.history-imported` event that replaces
the imported text snapshot. Source rewinds therefore remove stale replies. The previous import's
sequence and content revision identify each replacement, so retries and A-to-B-to-A source changes
both work. The serialized commit checks durable turn-start events before accepting an import.
SQL remains the owner of message search and pagination. Detail streams send the normal bounded
snapshot after replacement and keep full imported histories out of the replay cache.

Claude's SDK omits message timestamps. Those messages use the session's import timestamp and an
ordinal in their IDs to preserve conversation order. Codex messages use source turn timestamps when
available. [Import tests](../apps/server/src/orchestration/tests/session-import.test.ts) cover
pagination, search, source replacement, repeat imports, stream snapshots, and the first-message race.
The scan event records counts and bounded failure details without transcript text.
[Diagnostic tests](../apps/server/src/orchestration/tests/discovery-diagnostics.test.ts) exercise
real crashing and timed-out children.

The design keeps provider reads behind one import operation. A separate lazy transcript reader
was considered, but it would require every UI, search, and pagination caller to merge two histories.
Persisted replacement events reuse the existing projection and keep those callers unchanged. The
accepted limit is a one-way handoff on the first Platform message; provider and Platform message
identities are not reconciled for simultaneous editing.

The [server attention reducer](../apps/server/src/orchestration/utils/session-attention.ts) publishes
`needs-input`, `working`, or `settled`. Within `needs-input`, reasons have this priority: approval,
user input, interruption, unresolved worktree, failure, then plan. Explicit settle acknowledges existing failures; a later
failure raises attention again. Actionable work clears archive, snooze, and settle overlays in the
same committed batch.

## Environment ownership in the web app

[Scoped references](../packages/contracts/src/chat-ids.ts) pair each domain ID with a confirmed
`EnvironmentId`. The [web projection store](../apps/web/src/features/chat/state/chat-projection-store.ts)
retains a normalized slice per environment. Transports, drafts, selections, and pending work retain
their owner across asynchronous operations. Selecting a session activates its environment and opens
its checkout through the target editor runtime before publishing selection.

The rail groups the three attention states and carries environment identity on every row. Addresses
can begin with `@<environmentId>`; the primary environment omits that segment. Unknown environment
IDs remain rejected. [Address restoration tests](../apps/web/src/features/address/tests/grammar.test.ts)
and the [vertical recovery test](../apps/web/src/features/chat/tests/session-domain-recovery.integration.test.tsx)
cover this boundary.

One live chat transport remains active at a time. Concurrent connections and scoped persistence
belong to [Plan 078](../plans/078-federated-environments.md). Physical worktree creation, cleanup, and recovery use the
[worktree lifecycle](worktree-lifecycle.md).
