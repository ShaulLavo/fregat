# T3Code Chat Parity — Verified Gap Analysis and Roadmap

> **Re-measured 2026-08-10 against the tree at `43e8158`.** The original synthesis (2026-08-09, twelve independent
> dimension audits) measured ~40%. This revision re-verifies every previously-listed gap by grep-and-read against our
> current source — a gap is marked closed only where the _behaviour_ was traced end to end, not where a file appeared.
> Our files are kebab-case; reference paths are camelCase under `references/t3code/`.
>
> Verification evidence for this pass: `apps/server` **69 files / 660 tests pass**, `apps/web`
> (`--project node --project dom`) **183 files / 1198 tests pass**. `packages/tree` is knowingly red (Playwright
> chromium missing) and is out of scope.

> [!NOTE]
> **N0–N4 are all closed as of 2026-08-12.** The gap rows below are kept at the state they were audited in, with
> `closed` marking what has since landed — the _reasoning_ in each row is why the work was scoped the way it was, and
> deleting it would lose that. What is genuinely still open is only the short list under **Still open** at the end of
> the milestone section.

## Bottom line

**We are at ~80% of full T3Code chat parity, and ~86% of the parity we actually intend to build.** The two categories
that made the original assessment urgent are gone: **the agent no longer dead-ends, and nothing material is silently
lost on reload.** A user can pick a runtime mode from the composer, answer approvals and clarifying questions in-app,
run `/plan` on both drivers, see a real changed-files tree backed by real captured checkpoints, open a historical diff
in a real viewer, revert, reload, and reconnect mid-turn.

What is left has changed shape completely. It is no longer "the product blocks" — it is three narrower things:

1. **Two honest-data loose ends.** `pendingApprovalCount` / `pendingUserInputCount` are _still_ written as literal `0`
   and never recomputed (`projection-pipeline.ts:289-290`, `projector.ts:284-285`), and `thread-status.ts:33-34` is
   still the only consumer that matters. The approval panel works because the open thread derives pending state
   client-side from its own activity stream — but the **rail dot for a thread you are not looking at can never say
   "Waiting for you"** for an approval or a question. This is the single highest-value gap remaining. Separately,
   attachment blobs are still never deleted.
2. **Built-but-unreachable seams.** Four features are complete on both ends with nothing joining them: the settings
   panel is never mounted; server-side thread search is a working route the rail never calls; thread-detail pagination
   is a working query with no transport method and no "Load earlier"; terminal-selection capture has a capture util, a
   block grammar, a chip component and a draft-store slot, and zero code paths between them. Each is a small, sharply
   defined wiring task, not a build.
3. **Breadth we still have not started.** Git stacked actions with hook streaming, PR affordances, line-range review
   comments, project scripts, terminal link detection, title regeneration, the keybinding editor, the session reaper,
   the turn minimap.

Realistic remaining total: **~85–110 engineer-days** (down from ~300–360). Of that, category (1) and (2) together are
roughly **15 days** and buy back most of the perceived polish. **23 verified gaps remain deliberate non-parity** and
are excluded — one of the original 24 (`projection-cache-no-persisted-project-expansion-order`) is reclassified as a
real small gap now that we adopted project grouping ([why](#deliberate-non-parity)).

**One safety note that did not move:** `DEFAULT_RUNTIME_MODE` is still `'full-access'`
(`packages/contracts/src/orchestration-runtime.ts:101`). The composer now offers Supervised and Auto-accept-edits, so
this is a defensible default rather than a trap — but it is still a product decision that every new thread runs
unsupervised until the user says otherwise.

---

## Where we already are

| Dimension                                       | Parity | Was | What changed                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------- | -----: | --: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts (commands, events, ids, snapshots)    |    86% | 62% | 30 commands / 29 events. Added settle/snooze/pin/pin-reorder, typed user-input questions, `expectedBranch`, `implementedAt` + `implementationThreadId`, schema-enforced attachment caps, detail-snapshot `proposedPlans` + `checkpoints`, pagination anchors, `serverConfig`/`connected`/`synchronized` framing, provider slash commands + skills, a settings module, driver config envelope.                                          |
| Persistence (tables, indexes, caps)             |    84% | 62% | Real versioned ledger (`schema_migrations`, 4 migrations, per-migration transaction + double-check, structured failure). 15 tables: added `projection_thread_proposed_plans`, `projection_thread_checkpoints`, `app_settings`, inbox columns, activity `sequence`, pinned-order and composite indexes.                                                                                                                                 |
| Orchestration core (engine, decider, projector) |    85% | 43% | `command-invariants.ts` — 12 guards, 52 call sites in the decider. Real domain event bus with three reactors (provider-command, thread-deletion, checkpoint). Durable-vs-transient rejection gate, read-model reconcile after failure, capped + in-place read model (no clone), transactional catch-up, `project.delete` cascade, turn settling from session status, canonical `occurredAt`.                                           |
| Transport, streams, recovery                    |    84% | 40% | Replay-based resume with a retained tail and gap cap, `synchronized` marker, `connected` handshake + `serverConfig`, pong timeout enforcement, backoff ladder with offline parking and wake probe, per-thread sync store, thread-detail reconnect, shell deltas served by a row reader instead of a full snapshot per event.                                                                                                           |
| Frontend projection cache                       |    82% | 55% | Cross-reload persisted snapshot cache (throttled flush + hydrate, cursors stay at 0 so the served snapshot outranks it), idle eviction actually re-armed, sidebar prewarm removed, shell/detail writer authority split, snapshot-redelivery reconciliation, byte-bounded highlight LRU (300 entries / 24 MB), read/unread slice, persisted changed-files expansion.                                                                    |
| Composer / chat input                           |    82% | 30% | Mode + Access menu, approval and user-input panels, plan follow-up banner, mention decorator nodes with caret-preserving insert, surround-selection and Home/End plugins, IME guard, popover command menu, ranked provider slash commands + `$skill`, model options (traits) menu, width-driven compact footer, context ring in the footer, prompt stash, image lightbox.                                                              |
| Message timeline & markdown                     |    90% | 38% | Historical work log restored for every turn, turn-fold rows, tool outcome/output with expansion, plan rows, file-link chips into our editor, markdown user messages, anchored-new-turn scroll + a real follow-mode machine + remeasure compensation, structural row sharing, expansion hoisted into a store, image thumbnails, collapsed changed-files preview, copy-as-markdown.                                                      |
| Thread/session lifecycle & sidebar              |    84% | 30% | Settle / snooze / pin + fractional reorder, archived view, unread + seen tracking, keyboard commands (new / next / previous / jump-to-N / rail toggle), multi-select + bulk bar, delete dialog with neighbour fallback, stage header menu + rename, durable selection in `workspace-cache`, project grouping with status rollup, stable sort, palette Sessions group.                                                                  |
| Provider registry & runtime                     |    78% | 42% | `ProviderDriver` SPI + built-in drivers, per-instance `CODEX_HOME` / `CLAUDE_CONFIG_DIR`, settings→instance `reconcile()`, disk-backed status cache with identity correlation, credential watch, model-list merge on probe failure, `stopAll` on dispose, resume cursor preserved across parameter-change restarts, `sessionModelSwitch` read site, continuation identity.                                                             |
| Approvals, user input, plans, modes             |    84% | 28% | Full round trip in-app on both drivers: Codex `collaborationMode` plan instructions, Claude `ExitPlanMode` + `AskUserQuestion` (ordered before the full-access short circuit), generic tool approvals mapped to `'tool'`, proposed-plan projection with `implementedAt` so `hasActionableProposedPlan` is derived rather than latched, Implement / Refine.                                                                             |
| Checkpoints, diffs, revert, git                 |    76% | 30% | Capture is real: `checkpoint-store.ts` (`write-tree` / `commit-tree` / `update-ref` over a temp index), `checkpoint-reactor.ts` on the event bus with a pre-turn baseline drained before the provider touches the worktree, placeholder→upgrade guards, a checkpoint projection table, `DiffView` wired into `file-editor-body.tsx`, `reset -- .` after restore, `^{commit}` peeling, worktrees, base refs, branch diff, status cache. |
| Chat-adjacent surfaces & polish                 |    45% | 18% | Settings system built (contracts + server service + client panel) but **not mounted**. Command-palette sessions, footer context meter, `markdown-clipboard`, bounded git process I/O. Keybinding overrides exist as contract + read-only rows only.                                                                                                                                                                                    |

Average of the twelve: **80%**.

---

## The gap list

Only **remaining** gaps are tabled. Each milestone opens with the audit ids it closed, so the original findings stay
traceable. `Status`: `open` (nothing exists) / `partial` (some of it exists) / `diverged` (exists, behaves differently).

### M0 — Migration ledger and event-log integrity

**Closed:** `persistence-migration-ledger`, `persistence-activity-sequence-ordering`,
`timeline-activity-ordering-ignores-sequence`, `orch-projection-catchup-transaction`, `orch-readmodel-bounds`,
`persistence-readmodel-row-caps`, `ckpt-diff-output-cap-and-timeout`, `contracts-attachment-limits-not-enforced`.

Notes on the two ordering closures, because they closed differently than proposed: activities now carry a `sequence`
column written from `event.payload.activity.sequence ?? event.sequence`, and the **client** restores total order with
`compareActivities` (`chat-projection-writers.ts:1476`, sequence → createdAt → id). The server's paging query still
orders by `(created_at, activity_id)` — correct, because paging is a window and ordering is re-established after the
merge. The read model is capped (2 000 / 500 / 500) and `projectEvents` mutates in place; `cloneReadModel` is gone.

| Gap                                                                                                                                                                                                                                                   | Status  | Sev    | Effort | Ours                                                                               | Reference                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------ | ------ | ---------------------------------------------------------------------------------- | --------------------------------------------- |
| **Attachment blobs are never deleted** — still. `attachments/store.ts` exports only write/read/resolve; `ThreadDeletionReactor` stops the provider session and touches no blob; `pruneThreadAfterRevert` does not either. `persistence-attachment-gc` | open    | medium | M      | `apps/server/src/attachments/store.ts`, `orchestration/thread-deletion-reactor.ts` | `Layers/ProjectionPipeline.ts:330-468`        |
| **`causationEventId` is hardcoded `null`** (`decider.ts:673`) and event `metadata` is still `{}`, so the message→turn-start causal link is unreconstructible and approval `requestId` is never lifted into the envelope. `orch-causation-event-id`    | open    | low    | S      | `apps/server/src/orchestration/decider.ts:673`                                     | `orchestration/decider.ts:939-980`            |
| **Activities still `onConflictDoNothing`** (`projection-pipeline.ts:644`) — a re-emitted activity can never correct itself. Now lower risk since ordering no longer depends on it. `persistence-activity-sequence-ordering` (update half)             | partial | low    | S      | `apps/server/src/orchestration/projection-pipeline.ts:630-645`                     | `Layers/ProjectionThreadActivities.ts`        |
| **`CheckpointRef` / `ProviderItemId` are still unbranded strings** — `chat-ids.ts` brands nine ids, not these two. `contracts-checkpointref-provideritemid-brands`                                                                                    | partial | low    | S      | `packages/contracts/src/chat-ids.ts:24-32`                                         | `packages/contracts/src/baseSchemas.ts:74-87` |

---

### M1 — Server truth: decider invariants, engine receipts, projector correctness

**Fully closed.** Every row in the original M1 table is verified done: `orch-decider-invariants` (a real
`command-invariants.ts` with `requireProject`, `requireThreadNotDeleted`, `requireThreadNotArchived`,
`requireExpectedBranch`, `requireSettleable`, `requireSnoozable`, `requireActiveProjectWorkspaceRootAbsent`, … and 52
call sites), `orch-rejected-receipt-scope` (`isDurableCommandRejection` gates the persisted rejection),
`orch-turn-settle-on-session-status` (`settledTurnStateForSessionStatus` + `settleRunningTurn`),
`orch-session-stop-readmodel-divergence`, `orch-message-upsert-semantics`,
`orch-command-timestamp-canonicalization` (one server clock reading per command stamps every `occurredAt`),
`contracts-meta-update-expected-branch`, `orch-project-workspace-root-uniqueness`, `orch-project-delete-cascade` (a
real multi-command fold, one transaction), `orch-domain-event-bus`, `orch-thread-deletion-reactor`,
`thread-lifecycle-archive-delete-side-effects`, `thread-lifecycle-delete-fallback-selection`,
`thread-lifecycle-auto-pick-includes-archived`, `orch-readmodel-reconcile-after-failure`,
`persistence-stream-version-allocation` (the `max(stream_version)+1` subquery is folded into the
`INSERT … RETURNING`).

---

### M2 — Unblock the agent: runtime mode, approvals, user input

**Closed:** `approvals-no-runtime-mode-picker`, `composer-runtime-mode-control`,
`approvals-no-composer-approval-panel`, `composer-pending-approval-panel`, `approvals-no-user-input-panel`,
`composer-pending-user-input-panel`, `approvals-no-user-input-question-contract`,
`approvals-request-kind-unmapped-for-generic-tools`, `approvals-interaction-mode-not-applied-to-live-session`,
`approvals-codex-plan-mode-missing`, `approvals-claude-exitplanmode-missing`,
`approvals-claude-askuserquestion-missing`, `composer-plan-build-toggle`,
`approvals-interaction-mode-not-synced-to-thread`, `composer-standalone-slash-at-send`, `composer-ime-enter-guard`.

The panels are mounted at `chat-view.tsx:178-179` and driven by `ChatPendingRequestsProvider`, which derives open
requests from the thread's activity stream (`utils/pending-approvals.ts`, `utils/pending-user-input.ts`) exactly as
the original sequencing note recommended. `ClaudeAgentSession` now carries `interactionMode` through `matches`, and
`canUseTool` routes `AskUserQuestion` and `ExitPlanMode` **before** the full-access short circuit
(`claude.ts:1527-1539`, with the ordering documented in-file as the contract).

| Gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Status  | Sev      | Effort | Ours                                                                                                                                      | Reference                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **`pendingApprovalCount` / `pendingUserInputCount` are still structurally `0`** — written as literals at thread creation and recomputed nowhere. `thread-status.ts:33-34` is the consumer, so a thread you are **not** looking at can never show "Waiting for you" for an approval or a question; only the plan flag reaches the rail. The settle guard sidesteps this with `hasOpenBlockingRequest`, folding the read model's retained activities — which is the shape the projection should take. `persistence-pending-approvals-table`, `orch-pending-approval-projection` | open    | **high** | M      | `apps/server/src/orchestration/projection-pipeline.ts:289-290`, `projector.ts:284-285`, `apps/web/src/features/chat/lib/thread-status.ts` | `Layers/ProjectionPendingApprovals.ts`        |
| **`RuntimeMode` still lacks `auto`** — deliberate deferral (no adapter has behaviour distinct from `auto-accept-edits` yet), recorded so it is not re-discovered. `contracts-runtime-mode-auto`                                                                                                                                                                                                                                                                                                                                                                               | partial | low      | S      | `packages/contracts/src/orchestration-runtime.ts:4-8`                                                                                     | `packages/contracts/src/orchestration.ts:119` |

**Exit-criterion re-check (passes today):** a `/plan` turn on Codex and on Claude, in `approval-required`, answered
entirely from the composer. The one thing that still fails: telling _which of five threads_ is blocked without opening
each one.

---

### M3 — Checkpoints: capture → diff → revert

**Closed:** `ckpt-git-ref-checkpoint-store`, `orch-checkpoint-reactor`, `ckpt-capture-reactor`,
`ckpt-turn-zero-baseline`, `ckpt-diff-viewer-missing`, `ckpt-restore-leaves-index-staged`,
`persistence-turn-checkpoint-columns`, `orch-turn-checkpoint-columns`, `ckpt-checkpoint-projection-table`,
`ckpt-placeholder-then-upgrade`, `orch-turn-diff-placeholder-guard`, `orch-checkpoint-revert-parity`,
`ckpt-ref-peeling-in-diff`, `orch-runtime-receipt-bus` (subsumed by the reactor's `drain()`).

The load-bearing detail worth recording: the pre-turn baseline is enqueued while `thread.turn-start-requested` is
still publishing, and `checkpointBaselineSettled()` drains the reactor before the provider is allowed to touch the
worktree (`engine.ts:305-313`). That is what makes turn-0 diffs real rather than best-effort.

| Gap                                                                                                                                                                                                                                                                                                                                  | Status  | Sev | Effort | Ours                                                                                                            | Reference                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | --- | ------ | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **The client still keys checkpoint retries on `message.includes('fromturncount')`** (`checkpoint-diff-query.ts:182`) even though the server now has a typed catalog. This is the exact string-sniffing the catalog was built to delete. `ckpt-typed-checkpoint-errors`                                                               | partial | low | S      | `apps/web/src/features/chat/lib/checkpoint-diff-query.ts:182`, `apps/server/src/git/utils/checkpoint-errors.ts` | `checkpointing/Errors.ts`                     |
| **`ignoreWhitespace` exists server-side and is never sent** — `GitService` and `checkpoint-store` accept it, the reactor pins `false` for stat counting, and no client path ever asks for `true` for display. The reference's split (display `true`, stats `false`) is the point. Must be in the cache key. `ckpt-ignore-whitespace` | partial | low | S      | `apps/server/src/git/service.ts:248-268`, `apps/web/src/features/chat/lib/checkpoint-diff-query.ts`             | `checkpointing/CheckpointDiffQuery.ts:85,193` |

---

### M4 — Nothing is lost on reload: snapshot completeness, resume, reconnect

**Closed:** `contracts-thread-detail-snapshot-missing-plans-checkpoints`, `persistence-proposed-plans-table`,
`orch-proposed-plan-projection`, `approvals-no-proposed-plan-projection`, `approvals-hasactionable-plan-latched-true`,
`projection-cache-snapshot-redelivery-preserves-stale-plans-checkpoints`,
`projection-cache-thread-detail-stream-never-reconnects`, `transport-thread-stream-never-reconnects`,
`transport-no-resume-by-replay`, `contracts-stream-resume-and-sync-marker`, `transport-no-synchronized-marker`,
`transport-no-resume-gap-cap`, `transport-shell-stream-refetches-whole-snapshot-per-event`,
`projection-cache-detail-writer-clobbers-shell-authority`, `projection-cache-shell-resnapshot-wipes-detail-turn-state`,
`projection-cache-idle-eviction-never-rearmed`, `projection-cache-no-teardown-on-thread-removal`,
`projection-cache-prewarm-opens-unbounded-detail-subscriptions` (prewarm deleted outright),
`transport-no-socket-liveness-enforcement`, `transport-reconnect-backoff-ladder`,
`transport-no-network-and-wake-awareness`, `transport-error-message-sanitization`,
`transport-no-connection-status-ux`, `projection-cache-no-per-thread-status-or-error`,
`thread-lifecycle-sync-state-and-missing-thread`, `transport-server-config-handshake`,
`transport-no-version-skew-detection`, `contracts-proposed-plan-implementation-tracking`.

`resumePlan()` is the piece worth naming: `afterSequence <= 0` → snapshot; a gap larger than the retained tail →
snapshot (because a truncated replay would silently drop events); otherwise replay the retained events
(`streams.ts:131-147`).

| Gap                                                                                                                                                                                                                                                      | Status   | Sev | Effort | Ours                                                                                                                | Reference                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --- | ------ | ------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **Authoritative snapshots still ride the RPC socket** — `/shell-snapshot` and `/thread-detail` exist as HTTP routes and no web code calls them, so a large snapshot still head-of-line-blocks every other RPC. `transport-snapshot-not-loaded-over-http` | diverged | low | S      | `apps/web/src/features/chat/transport/orchestration-rpc-client.ts`, `apps/server/src/orchestration/routes.ts:74,85` | `state/shellSnapshotHttp.ts` |

---

### M5 — Timeline fidelity

**Closed:** `timeline-historical-work-log-dropped` (the derivation comment now states the rule outright: "Every turn's
work is derived, not just the running one"), `timeline-turn-plan-row`, `timeline-work-entry-status-affordances`
(`outcome` + `output` on `ChatWorkLogEntry`), `timeline-work-entry-detail-expansion`, `markdown-file-links`,
`timeline-user-message-rendering`, `timeline-anchored-new-turn-scroll` (a three-state
`anchoring-new-turn` / `following-end` / `free-scrolling` machine), `timeline-maintain-visible-content-position`,
`timeline-turn-fold-row`, `timeline-work-group-collapse-in-list-data` (hoisted into
`chat-work-log-expansion-store.ts`), `timeline-row-structural-sharing`, `timeline-live-follow-mode-machine`,
`timeline-image-attachment-thumbnails`, `composer-expanded-image-lightbox`,
`changedfiles-collapsed-preview-and-autoexpand`, `markdown-selection-copy-as-markdown`,
`markdown-list-indentation-normalization`, `markdown-highlight-lru-and-streaming-rule`,
`projection-cache-no-byte-bounded-lru-for-rendered-artifacts`, `timeline-assistant-meta-gating`,
`diffstat-compact-format-and-a11y`, `markdown-code-block-chrome`, `markdown-external-link-chrome`,
`proposed-plan-card-actions`, `approvals-plan-card-no-actions`.

| Gap                                          | Status | Sev | Effort | Ours                                                          | Reference                                      |
| -------------------------------------------- | ------ | --- | ------ | ------------------------------------------------------------- | ---------------------------------------------- |
| **No turn minimap rail.** `timeline-minimap` | open   | low | L      | `apps/web/src/features/chat/components/messages-timeline.tsx` | `components/chat/MessagesTimeline.tsx:714-917` |

---

### M6 — Composer completeness and plan follow-up

**Closed:** `composer-caret-after-mention-insert`, `composer-replacement-range-guards`,
`composer-plan-follow-up-actions`, `approvals-no-plan-follow-up-banner`,
`composer-command-menu-portal-positioning`, `composer-path-search-debounce`,
`composer-mention-serialization-grammar`, `composer-inline-decorator-chips`, `composer-inline-token-paste`,
`composer-slash-model-command`, `composer-provider-slash-commands`, `composer-skill-trigger`,
`contracts-model-selection-provider-options`, `composer-traits-picker`, `adjacent-traits-picker`,
`composer-compact-footer-layout`, `composer-context-window-meter-placement`, `composer-mac-home-end-keys`,
`composer-surround-selection-typing`, `composer-prompt-stash`, `composer-banner-stack`,
`thread-lifecycle-error-banner-dismiss`, `composer-context-menu-surface`,
`composer-draft-session-identity` / `thread-lifecycle-draft-mode-carryover` (solved by construction — the draft view
dispatches thread creation and the first message as one submission carrying model, effort, runtime mode and
interaction mode).

| Gap                                                                                                                                                                                                                                                                                                                                                          | Status  | Sev    | Effort | Ours                                                                                        | Reference                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ------ | ------ | ------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **No imperative composer insert seam** — `features/chat/providers/` has thirteen contexts and none of them can put text into the editor. This is the single blocker under terminal capture, editor "add selection to chat", file-tree mention drag and review comments. Expose it as one narrow provider action, not a handle. `composer-handle-insert-text` | open    | medium | M      | `apps/web/src/features/chat/providers/`, `components/chat-input.tsx`                        | `composerHandleContext.ts`               |
| **✅ File-tree drag into the composer — landed.** A dragged row arrives as a single-line `text/plain` absolute path (`packages/tree` is generic and sets no chat MIME type), so `composerDropMentionPath` identifies it by content: inside the open workspace, one line, not a `Files` drag. Anything else stays text. `composer-file-tree-mention-drag`     | closed  | low    | M      | `apps/web/src/features/chat/utils/composer-drop.ts`, `components/chat-input.tsx`            | `components/chat/composerMentionDrag.ts` |
| **"Implement plan in a new thread" is still missing** — in-thread Implement / Refine works and the server stamps `implementedAt`, so `hasActionableProposedPlan` clears honestly; only the new-thread variant is absent. `approvals-no-plan-implementation-thread`                                                                                           | partial | low    | M      | `apps/web/src/features/chat/components/proposed-plan-card.tsx`, `plan-follow-up-banner.tsx` | `components/ChatView.tsx:5590-5690`      |
| **✅ `draftPromotion` / `markDraftPromotion` deleted — landed.** Store field, action, and persisted schema entry all gone. `thread-lifecycle-draft-entity-and-promotion`                                                                                                                                                                                     | closed  | low    | S      | `apps/web/src/features/chat/state/chat-input-draft-store.ts`                                | —                                        |

---

### M7 — Thread inbox lifecycle: settle, snooze, pin, unread, search, archive

**Closed:** `contracts-thread-settle`, `orch-thread-settle-lifecycle`, `thread-lifecycle-settle-snooze-inbox`,
`contracts-thread-snooze`, `orch-thread-snooze`, `contracts-thread-pin`, `orch-thread-pin`,
`thread-lifecycle-pinning`, `persistence-thread-inbox-columns`, `thread-lifecycle-archived-browser`,
`thread-lifecycle-keyboard-navigation`, `adjacent-chat-keybinding-commands`,
`projection-cache-no-visited-unread-slice`, `thread-lifecycle-unread-and-visited`,
`thread-lifecycle-sort-order-policy`, `thread-lifecycle-multi-select-bulk-actions`,
`projection-cache-no-multi-thread-selection-slice`, `thread-lifecycle-stage-header-actions`,
`thread-lifecycle-command-palette-chat`, `adjacent-command-palette-chat-entries`,
`thread-lifecycle-no-route-identity` (selection persists through `workspace-cache`),
`thread-lifecycle-hero-and-project-picker`, `thread-lifecycle-no-project-onboarding`,
`thread-lifecycle-project-grouping`, `projection-cache-changed-files-expansion-not-persisted`,
`contracts-search-threads-rpc` (server half).

The settle guards landed on `hasOpenBlockingRequest` + `hasQueuedTurnStart` folding retained activities rather than
reading a pending-approval projection — a defensible structural choice, and the same fold the M2 counters should
adopt.

| Gap                                                                                                                                                                                                                                                                                                                                                                  | Status  | Sev    | Effort | Ours                                                                                                                 | Reference                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------ | ------ | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Server thread search is built and the rail never calls it** — `POST /orchestration/thread-search` is live over `OrchestrationThreadSearchQuery`, and `session-rail-model.ts:222` is still a local `sessionSearchText(item).includes(needle)` over title / project / branch. "Where did I discuss X" is still unanswerable. `thread-lifecycle-server-thread-search` | partial | medium | M      | `apps/web/src/features/chat-mode/utils/session-rail-model.ts:218-228`, `apps/server/src/orchestration/routes.ts:112` | `packages/client-runtime/src/state/threadSearch.ts` |
| **No title regeneration** — `titleSeed` still ships in the contract and is read by nothing; no request-id correlation, no regeneration protocol, and no text-generation service to hang it on. `contracts-title-regeneration`, `orch-title-regeneration-protocol`, `thread-lifecycle-title-regeneration`                                                             | open    | medium | L      | `packages/contracts/src/orchestration-commands.ts`, `apps/server/src/orchestration/decider.ts`                       | `Layers/ProviderCommandReactor.ts:901-1069`         |

---

### M8 — Provider platform: driver SPI, multi-instance, settings

**Closed:** `provider-driver-spi`, `provider-instance-config-contract`,
`contracts-provider-instance-config-envelope`, `provider-multi-instance`, `provider-settings-reconciliation`,
`provider-resume-cursor-on-restart`, `provider-session-model-switch-capability`,
`provider-snapshot-model-merge`, `provider-status-cache-disk`, `provider-background-health-refresh`,
`provider-shutdown-and-boot-reconciliation`, `provider-session-recovery`, `provider-continuation-identity`,
`provider-unavailable-shadow`, `provider-registry-identity-correlation`, `provider-ingestion-task-title`,
`provider-ingestion-lifecycle-guard`, `orch-pending-turn-start-rows`.

| Gap                                                                                                                                                                                                                                                                                                                                                                                                                  | Status  | Sev      | Effort | Ours                                                                                                               | Reference                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------- | ------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| **The settings panel is built and mounted nowhere** — `apps/web/src/features/settings/` has an API layer, hooks, a panel and nine components; `grep` for `SettingsPanel` outside that folder returns zero hits. Every settings-backed preference is therefore still unreachable by a user. Choosing the entry point (menu item, command, window surface) is the whole task. `adjacent-settings-system` (client half) | partial | **high** | S      | `apps/web/src/features/settings/panel.tsx`, app shell                                                              | `components/settings/SettingsPanels.tsx` |
| **Keybindings are still compile-time** — the settings contract carries `keybindings` overrides and `KeybindingSection` renders them **read-only by its own comment**; `keymap/active-bindings.ts` never reads settings and `KeyBindingSource` is still a union of one. Take the `event.code` letter/digit aliasing verbatim — it is a correctness fix for non-US layouts. `adjacent-keybindings-user-config`         | partial | medium   | L      | `apps/web/src/keymap/types.ts:5`, `active-bindings.ts`, `features/settings/components/keybinding-section.tsx`      | `apps/web/src/keybindings.ts`            |
| **Codex advertises no slash commands and no skills** — Claude populates both from `initialization.commands` and a skills probe; the Codex adapter's snapshot has neither, so `$` and `/` are half-empty for the default driver. `composer-provider-slash-commands` (Codex half), `adjacent-provider-skills` (Codex half)                                                                                             | partial | medium   | M      | `apps/server/src/provider/adapters/codex.ts`                                                                       | `providerSkillSearch.ts`                 |
| **No idle session reaper** — `last_seen_at` is written and never compared to a deadline. Still gated on the background-liveness signal below; a reaper without it kills long-running subagent work. `provider-session-reaper`                                                                                                                                                                                        | closed  | medium   | M      | `apps/server/src/provider/provider-session-directory.ts`                                                           | `Layers/ProviderSessionReaper.ts`        |
| **Ingestion feeds no plan progress or background liveness** — the shell still carries neither field, so the rail shows a coarse spinner instead of "step 3 of 7: running tests". `planProgress` is the higher-value half and is now cheap: the timeline already derives plan steps. `provider-ingestion-liveness-feeds`, `contracts-background-liveness-plan-progress`                                               | closed  | medium   | M      | `apps/server/src/orchestration/provider-runtime-ingestion.ts`, `packages/contracts/src/orchestration-snapshots.ts` | `orchestration/ThreadPlanProgress.ts`    |

---

### M9 — Scale: windowing, pagination, persisted cache, git caching

**Closed:** `transport-no-offline-snapshot-cache`, `projection-cache-no-persistent-snapshot-store`,
`persistence-projection-lookup-indexes`, `git-status-cache-and-broadcast` (server cache half),
`adjacent-background-activity-reporting` (recorded as prophylactic; our background work is demand-triggered).

| Gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Status  | Sev      | Effort | Ours                                                                                                                                                                                  | Reference                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Pagination is built on both ends and reachable from neither** — `SnapshotQuery.threadDetailPage()` is a real backwards-keyset query, `chatThreadEarlierPageInput()` mints the anchor from the caller's own oldest rows, and between them there is **no RPC method, no HTTP route and no UI**. `chatThreadEarlierPageInput` has test-only callers. History past the caps is still unreachable. `contracts-thread-detail-pagination`, `projection-cache-no-turn-windowing-pagination`, `timeline-load-earlier-header` | partial | **high** | M      | `apps/server/src/orchestration/snapshot-query.ts:157`, `routes.ts`, `packages/contracts/src/orchestration-ws.ts`, `apps/web/src/features/chat/state/chat-projection-selectors.ts:268` | `packages/client-runtime/src/state/threads.ts` |
| **React Query caches are still never invalidated on reconnect** — nothing observes the socket lifecycle; only an explicit sign-in invalidates. After a server restart `providerListQueryOptions` keeps serving pre-restart data. Expose a connection generation from the RPC client. `projection-cache-no-connection-generation-invalidation`                                                                                                                                                                         | open    | low      | M      | `apps/web/src/features/chat/transport/orchestration-rpc-client.ts`, `lib/query-client.ts`                                                                                             | `state/runtime.ts:490-533`                     |
| **No slow-RPC feedback** — still one flat timeout; a 40 s dispatch looks identical to a stuck one, and the per-request wide-event scope already holds the timing. `transport-no-slow-request-feedback`                                                                                                                                                                                                                                                                                                                | open    | low      | S      | `apps/web/src/features/chat/transport/orchestration-rpc-client.ts`                                                                                                                    | `rpc/requestLatencyState.ts`                   |
| **Timestamps still construct a fresh `Intl.DateTimeFormat` per call inside a virtualized list, and there is no relative-time helper** — `chat-formatters.ts:51,57,70`; the rail still says "Last message 14:02" where it should say "2h ago". The 12/24-hour preference can now ride the settings system. `adjacent-timestamp-settings-and-relative-time`                                                                                                                                                             | partial | low      | S      | `apps/web/src/features/chat/lib/chat-formatters.ts:45-75`                                                                                                                             | `timestampFormat.ts`                           |
| **Remote / PR half of git status broadcast** — the per-request `--porcelain=v2` cache and fingerprint landed; upstream and PR state still poll. `git-status-cache-and-broadcast` (remote half)                                                                                                                                                                                                                                                                                                                        | partial | low      | M      | `apps/server/src/git/service.ts`, `upstream-fetch.ts`                                                                                                                                 | `vcs/VcsStatusBroadcaster.ts`                  |

---

### M10 — Worktrees, git workflow, and adjacent capture surfaces

**Closed:** `git-worktree-support`, `contracts-turn-start-bootstrap-worktree` (session worktrees live inside the git
common dir under `platform-worktrees/`, which is what let the sandbox stay narrow instead of being widened to an
allowlist — the Open Decision the previous revision raised is answered), `ckpt-branch-range-base-ref-diff`
(`GET /base-refs` + `GET /branch-diff`).

| Gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Status   | Sev    | Effort | Ours                                                                                                                            | Reference                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Terminal capture is fully built and completely unwired** — `terminal/utils/capture.ts` produces a `TerminalContextSelection`, `readTerminalMenuTarget` puts it on the menu target, `chat/lib/terminal-context.ts` owns the `<terminal_context>` grammar, `TerminalContextChip` renders one, and the draft store has the slot. **`contextSelection` has zero consumers, the chip has zero render sites, `setTerminalContexts` has zero callers, and the terminal menu has no chat item.** Needs the M6 insert seam. `adjacent-terminal-context-capture`, `composer-terminal-context-insertion` | partial  | medium | M      | `apps/web/src/features/terminal/utils/commands.ts:22-34`, `utils/menu.ts`, `features/chat/components/terminal-context-chip.tsx` | `lib/terminalContext.ts`                          |
| **User bubbles would render raw `<terminal_context>` blocks** — `TRAILING_BLOCK_PATTERN` exists in `lib/terminal-context.ts`; `message-bubble.tsx` / `utils/message-text.ts` never call it. Must land with whichever capture surface ships first. `adjacent-user-message-context-stripping`                                                                                                                                                                                                                                                                                                     | partial  | low    | S      | `apps/web/src/features/chat/utils/message-text.ts`, `components/message-bubble.tsx`                                             | `components/chat/userMessageTerminalContexts.ts`  |
| **No commit/push/PR stacked action with progress and hook streaming** — a long pre-commit hook still looks like a hung button. `git-stacked-actions`                                                                                                                                                                                                                                                                                                                                                                                                                                            | closed   | medium | XL     | `apps/server/src/git/service.ts`, `routes.ts`, `apps/web/src/features/git/components/header.tsx`                                | `components/GitActionsControl.tsx`                |
| **No PR affordances from chat** — scope to GitHub via `gh` only. `git-pr-affordances-from-chat`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | closed   | medium | XL     | `packages/contracts/src/git.ts`, `apps/server/src/git/service.ts`                                                               | `sourceControl/PrTemplateDetection.ts`            |
| **No line-range review comments from diffs or files into chat** — now cheaper than when first audited: `DiffView` exists and is mounted, so only the annotation layer, the round-trip line addressing and the insert seam remain. `adjacent-review-comments`                                                                                                                                                                                                                                                                                                                                    | open     | medium | L      | `apps/web/src/features/git/components/diff-view.tsx`, `features/chat/providers/`                                                | `components/diffs/AnnotatableCodeView.tsx`        |
| **No persisted per-thread diff scope (branch / working tree / turn)** — including `reconcileTurnSelection` after a revert prunes checkpoints. The chat-mode tool pane's git tab is the host. `ckpt-diff-panel-scopes`                                                                                                                                                                                                                                                                                                                                                                           | open     | medium | L      | `apps/web/src/features/chat/hooks/use-open-checkpoint-diff-document.ts`, `features/chat-mode/components/tool-pane.tsx`          | `diffPanelStore.ts`                               |
| **Project scripts do not exist** — no `ProjectScript` type, no `scripts_json`, no meta-update field. `contracts-project-scripts`, `persistence-projects-scripts-column`, `orch-project-scripts`                                                                                                                                                                                                                                                                                                                                                                                                 | closed   | medium | M      | `packages/contracts/src/chat-model.ts`, `apps/server/src/db/schema.ts`                                                          | `packages/contracts/src/orchestration.ts:184-225` |
| **Terminal output has no clickable file paths or URLs** — the wrapped-line reassembly is the non-obvious part; the payoff is opening a stack-trace path in _our_ editor. `adjacent-terminal-link-detection`                                                                                                                                                                                                                                                                                                                                                                                     | open     | low    | M      | `apps/web/src/features/terminal/terminal-panel.tsx`                                                                             | `terminal-links.ts`                               |
| **`project.create` cannot mkdir a missing workspace root.** `contracts-project-create-delete-flags` (create half)                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | open     | low    | S      | `packages/contracts/src/orchestration-commands.ts`                                                                              | `packages/contracts/src/orchestration.ts:608-634` |
| **Image compression has no `HTMLCanvasElement` fallback; encoder throws report as `too-large`.** `adjacent-image-stash-compression`                                                                                                                                                                                                                                                                                                                                                                                                                                                             | diverged | low    | S      | `apps/web/src/features/chat/lib/image-compression.ts`                                                                           | `lib/imageCompression.ts`                         |

---

## Ordered milestones

M0–M10 as originally scoped are substantially delivered. What remains re-sequences into five much smaller milestones.
Foundation ordering still holds: **contracts → persistence → orchestration → transport → client store → UI**.

| #      | Milestone                           | Depends on | Rough effort | Exit criterion — _done when…_                                                                                                                                                                                                                                                                                         |
| ------ | ----------------------------------- | ---------- | -----------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **N0** | ✅ Honest counters + blob GC        | —          |         ~7 d | …a thread blocked on an approval or a question shows "Waiting for you" in the rail **without being opened**, by folding the same `hasOpenBlockingRequest` logic the settle guard already uses into the projection; and deleting a thread reclaims its image blobs from disk.                                          |
| **N1** | ✅ Wire the four built seams        | N0         |         ~8 d | …settings opens from a real entry point; typing a phrase in the rail search finds the thread whose _messages_ contain it; a 5 000-message thread paints its last turns with a working "Load earlier"; and selecting failing terminal output and choosing "Ask the agent" puts a chip — not raw XML — in the composer. |
| **N2** | ✅ Composer insert seam + capture   | N1         |         ~9 d | …one narrow provider action inserts text or a chip at the caret, and file-tree drag, editor "add selection to chat", and diff line-range review comments all ride it rather than each growing a handle.                                                                                                               |
| **N3** | ✅ Provider completeness            | N0         |        ~22 d | …Codex advertises its slash commands and skills like Claude does; the rail shows "step 3 of 7: running tests" instead of a spinner; a background-liveness signal exists and only then does an idle-session reaper land; and user keybindings can be edited and actually take effect, including on non-US layouts.     |
| **N4** | ✅ Git workflow + remaining breadth | N2         |        ~45 d | …a commit with a slow pre-commit hook streams its output instead of freezing a button; a branch can be pushed and a PR opened from chat; a diff line range becomes attached context; per-thread diff scope survives a reload and reconciles after a revert; project scripts exist; terminal paths are clickable.      |

**N3 status — done.** Codex reads its skills through `skills/list`, now in the generated protocol allowlist rather
than a hand-rolled `asRecord` walk; a response the pinned schema rejects fails loudly, because a silently short
catalog is worse than a visible error. Plan progress is a fold that survives replay and revert — which means it
outlives the turn that wrote it, so freshness is the _reader's_ job (`threadPlanProgressLabel` narrates only while
that same turn is running) and the cold read carries it too, or a reload strands a mid-plan thread on a spinner.

The reaper was strictly gated on liveness, and the gate was real: `last_seen_at` only moved on status transitions, so
a turn streaming for forty minutes read as untouched since it started. Ingestion now stamps liveness for every event
it accepts — the deltas and activities carrying no status are the whole point — throttled per thread. Only then does
the reaper reclaim, and only `ready` sessions: `waiting` is compaction or an unanswered approval, state that dies
with the process. It sweeps on the way into `ensureSession` rather than on a timer (reclaim before you allocate), and
never the thread being ensured, which is often the oldest row there is.

**N4 status — done.** A commit streams its hooks over SSE, with stderr rendered as `warning` because that is where
hooks conventionally narrate themselves. Push sets the upstream on a branch nobody has published — the only kind a
session creates. Pull requests go through `gh`, and every failure is _classified_ (`cli-missing`, `unauthenticated`,
`no-github-remote`) rather than collapsed into "no pull request": a caller that cannot tell those apart offers Create
to someone who already has one open. The two halves are deliberately separate queries — reading a PR shells out to
`gh`, and Publish must not wait on GitHub to appear.

Project scripts landed with both ends attached rather than as a stored field: discovery reads the workspace's own
`package.json` through the `fs.read` the editor already uses (no new route for a question the server can answer) and
picks the runner off the lockfile, and running goes through a terminal command inbox with the same
take-don't-broadcast shape as the composer's — at pick time there may be no terminal mounted, and exactly one must
run it.

**N2 status — done.** The seam is `composer-inbox-store.ts`: one queue carrying either a chip or text, taken by
whichever composer is mounted (`use-composer-inbox.ts`), fed by one narrow action (`use-attach-to-composer.ts`).
File-tree mention drag, the `draftPromotion` deletion and "implement plan in a new thread" all landed with it.

Two shapes worth recording, because both were arrived at by being wrong first:

- It is **not** the reference's `composerHandleContext`. A ref to a composer handle cannot work here: in the
  workbench the composer is genuinely unmounted when the capture happens (the sidebar is on Files), so the capture
  has to outlive the absence of an editor.
- It **takes** rather than drains. A composer whose editor has not mounted yet can honour a chip but not text, and
  the first attempt — drain everything, put back what did not fit — made the effect wake itself in an infinite loop.
  `take(accept)` leaves `pending`'s identity untouched when nothing is accepted, which is what breaks the cycle.

**Still open in N2's neighbourhood:** the editor's "add selection to chat" has a seam to ride but no source — the app
never holds an editor session, so nothing can read the current selection. `@singapore-editor/core` exposes `getSelections()`
on its document session; wiring that up is the prerequisite, not the composer side.

**Still open**, and none of it is on the N0–N4 path:

- The editor's "add selection to chat" has a seam to ride but no source — the app never holds an editor session, so
  nothing can read the current selection. `@singapore-editor/core` exposes `getSelections()` on its document session; wiring
  that up is the prerequisite, not the composer side.
- Title regeneration.
- The remote/PR half of the git status broadcast: upstream and PR state poll rather than being pushed. The polls are
  now cheap and separated (local git at 2s, `gh` at 60s), so this is an efficiency item, not a correctness one.
- `CheckpointRef` / `ProviderItemId` brands.
- `project.create` cannot `mkdir` a missing workspace root.

**Safely parallelizable:** N0 and N1's four seams are mutually independent and independent of N3. N2 must precede the
capture surfaces in N4 but nothing else. The turn minimap, `causationEventId`, the two brands, the client checkpoint
error catalog and `ignoreWhitespace` are all standalone small items that fit anywhere.

**Serialize strictly:** insert seam → terminal capture / mention drag / review comments. Background-liveness signal →
session reaper. Context stripping ships **with** whichever capture surface lands first, never after.

---

## Deliberate non-parity

> **Environment decision superseded 2026-09-05.** The rows below record the earlier audit.
> [The environment strategy](environments-and-remote-plan.md) now selects connected machines
> with separate checkouts. Plan 077 supplies the runtime foundation; Plans 068 and 078 add
> scoped domain references and federation. Pairing remains deferred.

Twenty-three verified gaps we should **not** copy. Four rows were reopened on 2026-09-24 and now point at their Plan 126 groups. Nothing new joined the list; one row left it
(`projection-cache-no-persisted-project-expansion-order`, reclassified below), and two had their _reasoning_ change
without changing the verdict (`provider-missing-drivers`, `contracts-archived-shell-snapshot`).

| Gap                                                                                   | Why not                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Effect runtime, `Layers`, `Scope`, PubSub, tagged errors                              | Our stack is Bun/Elysia/Drizzle/Valibot; the plan already locked this. We copy the architecture spine, not the runtime.                                                                                                                                                                                                                                                                    |
| `transport-single-implicit-environment`, `thread-lifecycle-multi-environment-scoping` | The reference federates relays, SSH hosts and remote desktops. We are a local workbench against one server we ship. Keep the `ChatEnvironment` seam; do not scope every entity key.                                                                                                                                                                                                        |
| Remote mode / auth / pairing (plan Phase 10)                                          | Same reason — and it drags in a credential model we have no product need for.                                                                                                                                                                                                                                                                                                              |
| `provider-missing-drivers` (OpenCode, Cursor, Grok)                                   | Each is an independent protocol integration. Now materially cheaper than when first assessed: the `ProviderDriver` SPI landed, so a new driver is an implementation rather than a fourth hardcoded singleton. ACP first — Cursor and Grok both ride it.                                                                                                                                    |
| `adjacent-element-context`, `adjacent-preview-annotation`                             | Downstream of an in-app preview browser (~60 files including webview hosts) we have no plan for. Building the composer half yields chips nothing can create.                                                                                                                                                                                                                               |
| `adjacent-pull-request-reference`                                                     | **Reopened 2026-09-24** as part of Plan 126 EXT-02, which plans the start-a-session-from-a-PR flow this row was waiting for. See `plans/126-t3code-alignment/delta-2026-09-24.md`.                                                                                                                                                                                                         |
| `adjacent-agents-panel`                                                               | The panel is the cheap half; the expensive half is a subagent runtime projection we do not model. Our per-subagent lifecycle is already visible inline as first-class task rows.                                                                                                                                                                                                           |
| `adjacent-usage-analytics`                                                            | **Reopened 2026-09-24** as Plan 126 EXT-17. Upstream now lets users edit model prices, which answers the staleness objection; Plan 141 implements it.                                                                                                                                                                                                                                      |
| `adjacent-client-tracing` (OTLP spans)                                                | Our project instruction is explicit that wide events beat narrow spans. The one real gap — client-to-server correlation — is fixed by propagating `requestId`, not by adopting an exporter.                                                                                                                                                                                                |
| `timeline-inline-diff-worker-pool` (`@pierre/diffs`)                                  | We deliberately open diffs in our own editor rather than embedding them; the only reference row that renders one inline is the review-comment card.                                                                                                                                                                                                                                        |
| `thread-lifecycle-open-in-picker` (open in VS Code / Cursor / Zed)                    | The reference needs it because it is not an editor. We are the editor. Parity here means handing users a way out of our own product.                                                                                                                                                                                                                                                       |
| `composer-mobile-enter-newline`                                                       | **Reopened 2026-09-24** under Plan 126 INTERACTION-11. The app is reached from phones over the mesh; Plan 143 discusses the phone layout.                                                                                                                                                                                                                                                  |
| `composer-draft-image-persistence`                                                    | Our exclusion is a documented trade that protects the text draft from the ~5 MB localStorage quota. Borrow only the "your attachments won't survive a reload" warning.                                                                                                                                                                                                                     |
| `git-ai-commit-message`                                                               | Our editor-native `COMMIT_EDITMSG` flow works. Wiring a second provider call path into git buys convenience we can get by asking the agent in chat.                                                                                                                                                                                                                                        |
| `git-branch-drift-follow`                                                             | **Reopened 2026-09-24** as Plan 126 EXT-18. Its own condition is met: branch PR state and create landed.                                                                                                                                                                                                                                                                                   |
| `persistence-per-projector-state` (nine projector cursors)                            | Our single projector runs inside the same transaction as the event append and receipt — a **stronger** atomicity guarantee than the reference's nine separate ones. Splitting it would weaken that.                                                                                                                                                                                        |
| `persistence-command-receipt-upsert`                                                  | Unreachable in practice, and parity would make an impossible state silently overwrite rather than fail loudly — the worse behavior for an idempotency ledger.                                                                                                                                                                                                                              |
| `persistence-checkpoint-diff-blobs-table`                                             | Dead in the reference too: a repo-wide grep hits only the migration that creates it. Recreating an unused cache table is pure schema debt.                                                                                                                                                                                                                                                 |
| `contracts-workflow-script-rpc`                                                       | Exists to support a native workflow/subagent runtime we do not have.                                                                                                                                                                                                                                                                                                                       |
| `contracts-repository-identity`                                                       | Its purpose is matching the same repo across machines/environments. Local `workspaceRoot` is sufficient identity for a single-host app.                                                                                                                                                                                                                                                    |
| `contracts-archived-shell-snapshot`                                                   | Purely a payload-size optimization; user-visible behavior is identical. Less pressing now that replay-based resume cut how often the shell snapshot is sent at all.                                                                                                                                                                                                                        |
| `orch-command-metrics-spans`                                                          | Our evlog wide events already carry per-stage timings and are the house style.                                                                                                                                                                                                                                                                                                             |
| `projection-cache-no-persisted-project-expansion-order`                               | **Reclassified.** We adopted project grouping after all (M7), so the original "not applicable" reason no longer holds. `session-rail-store.ts` keeps `collapsedProjectIds` in memory only, so a reload re-expands every group. This is now a genuine small gap (S) that we are choosing not to pay for yet — not a structural non-parity call. Move it into a milestone if users complain. |
| Legacy decoders / compat shims throughout                                             | Greenfield: no releases, no external users. Keep the canonical shape only, per CLAUDE.md.                                                                                                                                                                                                                                                                                                  |

---

## What the 2026-08-09/10 run landed

Eight phase commits on top of `748c394`, **425 files, +39 145 / −2 953**. All six gate commands green at each commit;
both suites re-verified green for this measurement.

| Commit    | Phase         | What it actually delivered (verified, not claimed)                                                                                                                                               |
| --------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `6e2d92b` | M0–M7 base    | Migration ledger, command invariants, domain event bus, checkpoint capture + reactor + projection, diff viewer, approval / user-input panels, plan mode on both drivers, snapshot completeness.  |
| `d85d30a` | M4 Resume     | Replay-based resume with gap cap, `synchronized` / `connected` framing, pong timeout, backoff ladder + offline parking + wake probe, per-thread sync store, retention teardown, prewarm deleted. |
| `1cf406d` | M8 Providers  | `ProviderDriver` SPI, per-instance homes, settings service + reconcile, disk status cache, credential watch, resume-cursor and `sessionModelSwitch` fixes. **Settings UI built, not mounted.**   |
| `a3c8da0` | M9 Scale      | Persisted projection cache, byte-bounded highlight LRU, composite indexes, git status cache, backwards-keyset detail page query. **Pagination transport + UI not built.**                        |
| `e49bbca` | M5 Timeline   | Historical work log, turn folds, tool outcome/expansion, plan rows, file-link chips, anchored scroll + follow machine, structural sharing, thumbnails, changed-files preview.                    |
| `486bdae` | M6 Composer   | Mention decorator nodes, caret-preserving insert, surround / Home-End plugins, popover command menu, ranked slash commands + `$skill`, traits menu, prompt stash, compact footer.                |
| `1b2c159` | M7 Inbox      | Settle / snooze / pin + reorder, archived view, unread, keyboard commands, multi-select, delete dialog, project grouping, palette sessions, thread-search **route**.                             |
| `43e8158` | M10 Worktrees | Session worktrees under the git common dir, base refs, branch diff, terminal capture **utilities**.                                                                                              |

### What the run left broken or unfinished

> **All six items below are closed as of N0 (`e395aa8`) and N1.** They are kept verbatim because the _failure mode_ —
> a feature complete on both ends with nothing joining them, passing every test it has — is the one this codebase
> keeps producing, and the list is the cheapest reminder of what it looks like.
>
> How N1 closed them: settings is a `Mod+,` dialog owned by `CommandProvider` (above the `rootFolder` branch, so
> it works with no folder open) plus a titlebar item and a palette entry; the rail unions server message matches into
> its own title/branch filter and renders a highlighted snippet per row; `threadDetailPage` became a WS request
> variant (protocol version 2) feeding a per-thread loader and an overlay "Load earlier" that the scroll machine
> compensates for via `prependedAboveItemId`; and the terminal menu's "Ask the Agent" queues the capture in an inbox,
> reveals chat, and the composer drains it into the draft as a chip that is serialized at send and stripped on render.

Nothing regressed and no test was weakened — both suites pass on real output. Four things are **built but not
reachable by a user**, which is a different failure mode than "not built" and is easy to mistake for done:

1. **`apps/web/src/features/settings/panel.tsx` is mounted nowhere.** Zero references outside its own folder and its
   own test. Every settings-backed preference is unreachable.
2. **Thread search never leaves the server.** `POST /orchestration/thread-search` works; `session-rail-model.ts:222`
   still filters titles with `.includes()`.
3. **Pagination has no transport.** `SnapshotQuery.threadDetailPage()` and `chatThreadEarlierPageInput()` both work
   and are separated by a missing RPC method, route and header.
4. **Terminal capture has no connecting path.** Capture util → menu target → grammar → chip → draft slot, all present;
   `contextSelection`, `TerminalContextChip` and `setTerminalContexts` each have zero production consumers.

Two verified data-honesty defects survived the run untouched:

5. **`pendingApprovalCount` / `pendingUserInputCount` are still literal `0`** and still read by `thread-status.ts`.
   The rail cannot report a blocked thread. The fix now has a proven shape to copy — `hasOpenBlockingRequest` in
   `command-invariants.ts:196`.
6. **Attachment blobs are still never deleted.**

And three smaller loose ends worth naming so they are not rediscovered: the client still string-matches
`'fromturncount'` for checkpoint retries despite the server's typed catalog; `draftPromotion` /
`markDraftPromotion` are dead store fields; `causationEventId` is still hardcoded `null`.

---

## Corrections to the existing plan doc

`docs/t3code-parity-implementation-plan.md` should now be retitled
`🔴 SUPERSEDED — see docs/t3code-chat-parity-gap-analysis.md`. Most of the previous revision's sixteen corrections are
resolved by the work above; these are the ones that still matter:

1. **Phase 0 › "First runtime mode: full-access … do not build supervised UI or enforcement in V1"** — the UI now
   exists, so this is no longer a safety gap. It is now only a **default**: `DEFAULT_RUNTIME_MODE = 'full-access'`
   still maps to Codex `danger-full-access` and Claude `bypassPermissions` for every new thread. Re-decide the default
   deliberately rather than by inheritance.
2. **Phase 0 › "Not in V1" list** — fully stale. Checkpoints, diffs, revert, approvals, plan mode, worktrees, settle /
   snooze / pin and a settings system are all built.
3. **Phase 1 › "Deferred tables"** — `projection_thread_proposed_plans` shipped.
   `projection_pending_approvals` did **not**, and its absence is now the highest-value remaining gap (see N0). Note
   that the settle guards solved the same problem by folding retained activities, which is the cheaper shape.
4. **Phase 3** — both previously-failing claims are now true: `afterSequence` genuinely replays from a retained tail
   with a gap cap, and the thread-detail stream reconnects on a backoff ladder.
5. **Phase 4** — retention is now real: `reconcileAll()` has a production caller and the prewarm helper was deleted
   rather than bounded.
6. **Phase 7C › `titleSeed`** — still shipped in the contract and read by nothing. Wire it (N3-adjacent) or delete it;
   it has now survived two audits unused.
7. **Phase 7E / 7F** — both delivered. Changed-files summaries are fed by real captures and diffs open in a real
   viewer.
8. **Open Decision › "Whether hidden Git refs are acceptable for every workspace or should be opt-in"** — still open,
   but no longer blocking: capture shipped with hidden refs. Decide before anything user-visible depends on ref
   layout.
9. **Open Decision › widening `fs/path.ts`'s `assertInside` sandbox** — **resolved without widening.** Session
   worktrees live under the git common dir (`platform-worktrees/`), inside the sandbox, so the security-relevant
   change was avoided. Record this as the answer, not as an open question.

---

## Convention notes for implementers

Per `CLAUDE.md`, applied to every target path above:

- **Files are kebab-case; group by feature then kind.** New server modules go in the owning feature dir; new pure
  client modules go in `utils/`, not `lib/` — `features/chat/lib/` is now the larger of two homes for pure logic and
  should be normalized in one pass rather than grown further.
- **No barrels.** Import exact files through `@/`.
- **One component per file, one hook per file.**
- **No prop drilling.** The N2 insert seam is the canonical example: expose `insertComposerText` (or
  `insertComposerChip`) as one narrow provider action, not a handle threaded through `chat-view` → `chat-input` →
  `chat-input-editor`.
- **Never-nester.** The pending-approval fold, the pagination merge and the terminal-context strip are all guard-clause
  shaped; keep nesting ≤ 3 and never use a nested ternary.
- **Theme tokens only.** Approval panels `warning`, failures `destructive`, plan-ready `info`, tool success `success`.
  Floating panels use `surface-vibrancy` without `bg-popover`; in-pane chrome uses `backdrop-material`.
- **`tabular-nums` on every updating number:** approval counters, plan step counters, turn durations, diff stats,
  context-window percentages, "Load earlier" counts.
- **Errors via `createStructuredError` / `defineErrorCatalog`, never `new Error`.** The checkpoint catalog already
  exists server-side (`git/utils/checkpoint-errors.ts`); N0's remaining work is making the **client** read `code`
  instead of sniffing `message`.
- **Logs are wide events.** Enrich the one event per operation (`pendingApprovalCount`, `pageRowCount`,
  `searchMatchCount`, `blobsReclaimed`) rather than emitting extra narrow lines.
- **Tests are Vitest against the real in-process server** — `apps/web/test/fixtures.ts`, real `treaty` client,
  `MockProviderAdapter` (a production adapter, not a stub), a real `git init` temp repo for checkpoint and worktree
  work. Run app tests with `bun --bun vitest`. Do not `vi.mock` our own modules. `--project browser` hangs here; use
  node/dom, or drive the running dev server at `:5173` via Playwright.
- **Greenfield.** When these fixes invalidate persisted state (localStorage drafts, the projection cache, the SQLite
  file, checkpoint refs), delete it or tell the user what to delete. Do not write healing code.
