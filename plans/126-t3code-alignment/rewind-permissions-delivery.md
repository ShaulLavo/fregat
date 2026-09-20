# Rewind, native permissions and PR lookup delivery

Implementation delivery on 2026-09-20. These changes do not establish full Plan 126 parity.

Server release `20260920T125500Z-02885149-plan126-rewind-permissions` includes explicit
conversation-only rewind, provider/runtime preflight, real linked-worktree isolation checks,
native permission response serialization and PR lookup failure propagation. Web release
`20260920T125946Z-b915d3e0-rewind-draft-identity` also fixes rewind's environment identity lookup.

## Rewind

`restoreFiles` is required on the command. Conversation-only rewind preserves working bytes
and the Git index. File restore requires a ready linked Git worktree and rejects overlap with
other sessions, including archived sessions, and active native runtime directories.
Unsupported providers, unavailable runtimes and unavailable native rewind boundaries fail before file restore. Native preparation returns a commit operation only after locating the target turn. Busy sessions fail
at command admission. A durable pending-rewind reservation blocks conflicting sends and
workspace changes until correlated completion or failure. A rejected send remains retryable
with the same command ID. Restart reports interruption and releases the reservation without
replaying destructive work. Six admission and nineteen migration tests pass. Native rollback can still fail after file restore; upstream ordering
is not a transaction across Git and a provider.

The web confirmation separates conversation-only and file-restore actions. It prepares
image bytes and checks draft capacity before dispatch, waits for the correlated canonical
completion, then merges the original prompt, images and terminal context into the captured
draft. Later edits and navigation do not change that destination. Server failure keeps the
confirmation open. The TUI confirmation also requires an explicit file-restore choice.

## Native permissions

Codex pending requests retain their native method, ID, requested permission profile and
parent/child ownership. Permission acceptance returns the profile, session acceptance adds
`scope: 'session'`, and denial/cancellation returns an empty profile. Validation happens
before consuming the request. Command/file approval response shapes are unchanged.

## Pull request lookup

Lookup uses `gh pr list --head … --state open --limit 1`. Only a successful, validated empty
array means no open PR. Process failures, timeout, invalid JSON and invalid records throw
structured errors. Creation does not run after failed lookup. Existing CLI/auth/repository
support admission remains separate from an admitted lookup failure.

## Evidence and limits

- Real Git/engine checkpoint tests cover conversation-only bytes and index preservation,
  shared-root refusal, shared linked-worktree refusal with active and archived peers,
  unavailable runtime and unsupported rollback, missing native boundary before Git mutation,
  unexpected native commit rejection without canonical pruning, and successful isolated restore.
- The native protocol regression traverses two descending pages and proves `thread/revert` is
  deferred until the prepared operation is committed. Eighteen focused checkpoint/native tests pass.
- The correlated client wait is exercised against the real engine for completion and failure.
  A real-server hook test catches environment ID versus origin confusion.
- Draft-store tests preserve newer edits and another session's draft. Dialog tests cover
  explicit confirmation and disabled controls.
- Six native-process permission tests exercise exact replies, parent/child ownership,
  duplicate replies, malformed profiles and existing command/question responses.
- Sixteen PR process-boundary tests cover absence, existing/create success, auth expiry,
  network/rate-limit/timeout and malformed responses.
- Server, web, TUI and client-core typechecks pass. Changed-file lint, design census and
  deployment candidate/live checks pass.

Live conversation-only rewind passed on web release `20260920T133225Z-b915d3e0-rewind-composer-sync`
over server release `20260920T132650Z-b915d3e0-plan126-live-delivery`.
Evidence: `/work/tmp/fregat-evidence/20260920T133321Z-scenario-checkpoint-rewind/`.
The inspected final screenshot shows removed history and the original prompt above the newer
draft. No server warning/error occurred. A preceding live run exposed that mounted Lexical
editors did not observe externally restored drafts; the draft plugin now synchronizes them,
with a regression covering focus preservation, later edits and another session's draft.

The live runs also caught an environment identity lookup bug and Codex 0.154.0 rejecting the
old `thread/rollback` method on paginated threads. The adapter now uses `thread/revert` with
a prepared `beforeTurnId` from descending `thread/turns/list` pages. The installed schema was
generated at `/work/tmp/plan126-codex-schema`; current [OpenAI protocol documentation](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md#thread-rollback)
also directs paginated threads to this API. This adapts native transport while retaining the
requested conversation behavior. The baseline is
`/work/tmp/fregat-evidence/20260920T125035Z-scenario-checkpoint-rewind/`.
No paired upstream rewind runtime execution or full provider/host matrix has been completed.
