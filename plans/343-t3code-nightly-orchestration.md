# Plan 343: Rewrite orchestration against published T3 Code nightly

Status: **Approved, deferred at the owner's request, 2026-10-10.** This planning pass updates
references and execution plans. Start application implementation when the owner resumes this
program. The size of this rewrite does not change that scheduling decision.

Priority: P1 when resumed. Effort: XL, multiple delivery waves. Risk: high.
Planned against Fregat `917e6da49` on 2026-10-10.
Reference: published nightly `v0.0.46-nightly.20261010.2922`, source
`bd2346eda2e2c380d1844869c7fd16c279d2190f`, published at 08:44:21 UTC.
Owner: orchestration, provider, persistence, shared client, and chat owners.
Scheduler: [root PLAN.md](../PLAN.md). Earlier scope: [Plan 126](126-t3code-alignment.md).

## Outcome

Replace the orchestration design derived from September T3 Code with the published nightly's
run, execution, durable-effect, provider-ownership, and client-projection model. A submitted
message becomes durable user intent with an explicit run. Commands, provider attempts, requests,
background work, and visible timeline items have separate identities and outcomes. Restart,
reconnect, Stop, queue edits, provider changes, and deletion preserve those distinctions.

The rewrite includes contracts, SQLite persistence, server command admission, durable side effects,
provider adapters, websocket and snapshot delivery, shared client state, the web composer and
timeline, and TUI consumption. Existing editor, terminal, Git, native-host, attachment, settings,
and remote-environment capabilities keep their own owners and behavior requirements.

Complete alignment means every in-scope nightly operation has a reviewed Fregat mapping and
acceptance result, or an explicit owning plan with its retained gate. Source comparison alone
does not establish runtime equivalence. The old ledger and percentages provide historical context.

## Read this before execution

1. Read repository `AGENTS.md`, [development setup](../docs/development.md), and
   [the reference guide](../docs/t3code-reference.md). Load the applicable local and package skills.
2. Reconcile drift before assigning units:

   ```sh
   git diff --stat 917e6da49..HEAD -- apps/server/src/orchestration apps/server/src/provider apps/server/src/db packages/contracts/src packages/client-core/src apps/web/src/features/chat apps/tui/src/chat
   python3 -B plans/343-t3code-nightly/reference-audit.py --reference references/t3code
   ```

3. Re-read changed owners and update the affected unit before implementation. A changed path
   requires source reconciliation; it does not invalidate unrelated completed work.
4. Verify the reference tag resolves to the manifest's full commit. Use `git show` at that commit
   for every upstream citation. A later checkout does not advance the acceptance baseline.
5. Capture a fixture-backed baseline before replacing a behavior. Keep evidence with source
   revisions, input corpus, commands, and observation limits.

The owner has authorized this plan and reference refresh. This pass authorizes no owner-state
reset, pairing replacement, live-provider automation, desktop redesign, or deployment. When
implementation starts, qualify the new system in isolated state before the final data decision.

## Why the old plan is insufficient

Plan 126's acceptance pin is `7445aa733ada33e45289e5aa5055f79142556513`. Its original audits name
`orchestration/Layers/OrchestrationEngine.ts`, a decider/projector, provider command reactors,
provider runtime ingestion, and the old web projection stores. Nightly introduces a distinct
`apps/server/src/orchestration-v2/` implementation and `packages/contracts/src/orchestrationV2.ts`.
Its web state delegates orchestration to `packages/client-runtime`.

Changing a commit string on those audits would misrepresent their findings and executed cases.
The October 3 finite closeout remains valid for its bounded deliveries. It cannot close this
rewrite, establish v2 coverage, or tell an executor how to migrate the new identities.

The important changes are ownership and persistence:

| Concern             | Current Fregat starting point                                                       | Nightly target to study                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Command concurrency | `engine.ts` has one process-wide command queue                                      | `ThreadCommandExecutor.ts` serializes planning per thread, shared with deletion                                                 |
| Commit              | Events, projections, receipts commit together; postcommit event reactors start work | `EventSink.ts` also records durable effects atomically and orders publication after commit                                      |
| Work identity       | Session, turn, provider runtime, message, and activity contracts                    | Application thread, run, run attempt, execution node, runtime request, and turn item contracts                                  |
| Follow-ups          | Web-owned retained queue and follow-up policy                                       | Durable message intake, queued runs, steering, queue edit/cancel/reorder, request-held execution                                |
| Side effects        | In-memory reactors and specialized recovery paths                                   | `EffectOutbox.ts` and `EffectWorker.ts`, with process-loss rules for each effect type                                           |
| Provider recovery   | Session directory, runtime epochs, interruption and reaper policies                 | Provider process sessions, native threads, attempts, guarded writes, recovered continuation and background cancellation records |
| Client lifecycle    | Web supervisors and TUI `ChatOwner` share reducers but own lifetimes separately     | Shared `packages/client-runtime` shell/detail/execution owners and v2 timeline adaptation                                       |
| Acceptance          | September inventory and bounded paired policy comparisons                           | Fresh operation map and fixture-backed cases at the published nightly pin                                                       |

These are source findings. This planning pass does not report provider runtime parity or speed.

## Evidence and source map

Paths in this table are relative to each repository. Upstream paths are pinned to the full
nightly commit above. File names identify starting points; follow callers before changing owners.

| Area                            | Upstream anchors                                                                                                                                                                           | Fregat anchors                                                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts and command admission | `packages/contracts/src/orchestrationV2.ts:364`, `:543`, `:601`, `:626`, `:3066`; `orchestrationDispatch.ts`                                                                               | `packages/contracts/src/chat-ids.ts`, `chat-model.ts`, `orchestration-commands.ts:63`, `orchestration-events.ts`, `orchestration-projection.ts`, `orchestration-ws.ts`                             |
| Commit and publication          | `apps/server/src/orchestration-v2/EventSink.ts:232`, `:527`; `EventStore.ts`, `CommandReceiptStore.ts`, `ProjectionStore.ts`                                                               | `apps/server/src/orchestration/engine.ts:655`, `event-store.ts:44`, `command-receipts.ts`, `projection-pipeline.ts`, `db/schema.ts`                                                                |
| Effect recovery                 | `apps/server/src/orchestration-v2/EffectOutbox.ts:121`, `:133`; `EffectWorker.ts`, `ProviderRuntimeRecoveryService.ts`, `RestartContinuation.ts`                                           | `orchestration/bootstrap.ts:1`, `engine.ts`, `provider-command-reactor.ts`, `reactor-scheduler.ts`, `provider-runtime-ingestion.ts`, `provider/provider-service.ts`                                |
| Provider normalization          | `packages/provider-core/src/server/ProviderAdapter.ts:403`; server `orchestration-v2/ProviderEventIngestor.ts:273`, `ProviderSessionManager.ts`, `ProviderAdapterRegistry.ts`, `Adapters/` | `provider/provider-adapter-registry.ts`, `provider/provider-session-directory.ts`, `provider/adapters/`, `orchestration/provider-runtime-buffers.ts`                                               |
| Message and requests            | `orchestration-v2/ThreadMessageIntake.ts`, `RunExecutionService.ts`, `RuntimeRequestService.ts`, `ProviderTurnControlService.ts`                                                           | `orchestration/approval-admission.ts`, `message-questions.ts`, `pending-requests.ts`; web `features/chat/state/submit-message.ts`, `follow-up-store.ts`, `composer-inbox-store.ts`                 |
| Checkpoint and cleanup          | `orchestration-v2/CheckpointRollbackService.ts`, `CheckpointRestoreSafety.ts`, `ThreadDeletion.ts`, `AttachmentClaims.ts`                                                                  | `orchestration/checkpoint-reactor.ts`, `rewind-admission.ts`, `rewind-isolation.ts`, `session-deletion-reactor.ts`, `attachments/ownership.ts`                                                     |
| Server reads and streams        | `orchestration-v2/WireProjection.ts`, `ShellStream.ts`, `LiveStreamBudget.ts`, `http.ts`; server `ws.ts:744`                                                                               | `orchestration/routes.ts`, `ws-rpc.ts`, `streams.ts`, `snapshot-query.ts`, `live-stream-budget.ts`                                                                                                 |
| Client synchronization          | `packages/client-runtime/src/state/orchestration.ts`, `shell.ts:217`, `:345`, `threadDetail.ts`, `threadExecution.ts`; web `state/orchestration.ts`                                        | `packages/client-core/src/chat/owner.ts:63`, `writers.ts`, `types.ts`, `transport/orchestration-rpc-client.ts`; web `features/chat/state/shell-subscription.ts`, `session-detail-subscriptions.ts` |
| Timeline and composer           | Web `lib/orchestrationV2Timeline.ts`, `components/chat/`, `composerDraftStore.ts`                                                                                                          | Web `features/chat/components/`, `state/chat-input-draft-store.ts`, `state/chat-projection-store.ts`, `utils/`                                                                                     |

Use the [pin manifest](343-t3code-nightly/reference-pin.json) for source tree/blob identities and
[reference inventory](343-t3code-nightly/reference-inventory.json) for remaining repository citations.

## Choose the implementation shape

### Caller experience

The caller submits one command with an environment and session owner. It receives durable
acceptance or a structured rejection. It subscribes to authoritative execution and projection
state to observe provider work. A component does not coordinate persistence, effect enqueueing,
provider startup, or replay. A lost response can be resolved using the same command ID and intent.

A queue edit changes durable intent before execution. Stop targets the accepted run and supported
background work. Answering a request targets its originating attempt and request identity.
Changing the active UI session cannot retarget any of these operations.

### Domain and interfaces to sketch in unit N1

Use schema-derived discriminated unions and branded IDs. Exact names are decided in N1; these
are responsibilities, not declarations to paste into source.

| Domain          | Required distinction                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| Session         | App conversation identity, environment, project, worktree, lineage, selected model and policy         |
| Run             | Durable admitted work, queue order, message/context ownership, prepared/queued/running/terminal state |
| Run attempt     | One provider execution of a run; provider session/thread/turn IDs and generation                      |
| Execution node  | Root or child work, parent identity, status, outputs, usage, and request ownership                    |
| Runtime request | Approval/question kind, attempt/node association, available answers, response and expiry              |
| Turn item       | Stable timeline identity, position/revision, typed content, references and bounded output             |
| Effect          | Durable side-effect intent, owner, deterministic identity, process-loss policy and outcome            |
| Receipt         | Command ID, intent fingerprint, accepted/rejected outcome, committed sequence and domain result       |

The orchestrator owns `dispatch(command, context)`, authoritative snapshot reads, scoped live
subscriptions, startup recovery, and shutdown. Its durable commit owner hides events, projections,
receipts, and effect rows behind one transaction. The effect worker owns claim, execution,
cancellation, and settlement. Provider adapters hide native protocols behind typed capabilities
and owned provider references. The shared client owner hides snapshot/subscription readiness,
sequence reconciliation, retained detail, and disposal behind the client operations consumers need.

Keep direct helpers for pure policies. Do not create a stage-per-file pipeline or wrapper that
forwards unchanged arguments. Persistence representations stay private to the repository layer.
Transport validation stays at the network boundary. Domain functions consume validated types.

### Candidate designs and provisional decision

Candidate A ports nightly's domain and durable-effect model into Fregat's typed Bun services,
Drizzle transactions, Valibot contracts, and TanStack-owned client operations. Candidate B keeps
an isolated Effect orchestration core with one lifecycle-owned runtime, adapting Elysia and
Fregat client contracts at its boundaries.

Use A as the planning base. It preserves the existing runtime, error, transaction, and client
ownership conventions and makes the domain rewrite visible without a second framework migration.
Borrow B's explicit lifetime ownership and separation of durable intent from process execution.
Both candidates require the same ownership and recovery proofs. An Effect dependency alone
cannot establish durable delivery or safe replay.

The qualification in N0 must compare maintained code and failure behavior for a single complete
command, commit, effect, and restart path. If B removes substantial ownership code while preserving
Fregat errors, cancellation, and persistence, update this decision with measured evidence before N1.
Do not mix Effect fibers with separately owned Promise supervisors for the same operation.

The independent cold review scores A 24/25 and B 22/25 for provenance, ownership coverage,
executable stages, deferred/data boundaries and retained capability scope. Both meet the domain
requirements. A wins on executable Fregat integration and scope. The review requested precise
nightly-release selection and explicit TUI/client-core checks; both are incorporated.

Accepted costs: this is a domain rewrite, and porting upstream semantics requires ongoing reviewed
deltas. Rejected alternatives include another layer around the current engine, two production
orchestrators, a frontend-only v2 adapter, and a generalized worker/actor package as a prerequisite.
Those shapes leave old ownership in charge or add a separate migration without proving this one.

## Invariants every unit preserves

1. A command ID has one intent and one durable outcome. Same ID with different intent rejects.
   Preserve Fregat's existing `commandFingerprint` and `verifyReceiptIntent` protection.
2. Commit events, projection state, command outcome, and required durable effects together.
   Rollback leaves none of the command visible. Publish after commit in increasing sequence order.
3. Serialize conflicting commands at their domain owner. Acquire multiple owners in a stable order
   for project deletion and cross-session actions. Independent owners may execute concurrently.
4. An accepted command is distinct from a started provider attempt and a settled effect.
   Transport timeout or canceled UI wait does not imply the effect failed or did not happen.
5. A valid no-op command still receives a durable receipt. Replaying an old Stop cannot stop
   work created after that Stop. Filtered streams use monotonic cursors within one global
   application sequence; a numeric gap can belong to another owner and does not itself prove loss.
6. Process-loss recovery classifies effects. Native start/steer/interrupt/restart/request-response
   operations cannot be blindly resent after a crash. Explicit continuation is new domain work.
7. Native events identify the owning provider session, generation, run attempt, and node. Stale
   provider events cannot update a replacement attempt or answer another session's request.
8. Snapshot and subscription handoff cannot lose events. Scoped streams distinguish replaceable
   projection updates from lossless domain intent and have finite count/byte retention.
9. Persist user intent and necessary execution truth. Reconstructible client projection state is
   fetched from authoritative state on a new lifetime. Drafts and attachments retain explicit owners.
10. Delete and rewind respect Git/worktree/terminal/provider ownership and all attachment claims.
    A canceled provider task and a deleted conversation do not authorize deleting unrelated work.
11. Settings retain declared consumers and scopes. New execution settings use application or
    machine scope. No new hardcoded knobs or environment-variable tuning contracts.
12. One wide structured log event describes each operation with IDs, observed state, outcome, and
    timing. Content, prompts, setting values, and credentials stay out of messages and logs.
13. Fregat's no-version-skew rule applies. Change producers and consumers together. Upstream v1
    import, persisted-version healing, unknown-old-client fallbacks, and negotiation are excluded.

The invariant order describes obligations, not an instruction to add defensive guards throughout
internal code. Encode them in domain types, transactions, owner lifetimes, and focused tests.

## Scope and adjacent owners

Implementation may change contracts, server orchestration/provider/persistence, shared client core,
web chat and needed command/settings consumers, TUI chat, and their tests and verification scenarios.
Track exact paths per unit at launch. Root lint/tool config is ordinary source when a unit needs it.

Preserve these neighboring boundaries:

| Plan or owner                                      | Dependency and retained scope                                                                                                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 126 lifecycle/runtime/interaction/adjacent records | Scope inputs and dated receipts. N0 assigns every affected open row to a nightly unit or explicit existing owner. Already delivered capabilities get regression cases.     |
| 328–334 async runtime                              | Approved and deferred independently. This rewrite needs durable effect execution, not adoption of the general worker package. Qualify reuse later against a real consumer. |
| 342 reactivity and async ownership                 | Coordinate shared TanStack and mutation owners. Establish the current delivery state before N8; migrate each command through one mutation owner.                           |
| 144 unattended and multi-agent work                | N6 supplies run/node/background identity and completion semantics. Scheduling product behavior remains separately scoped.                                                  |
| 145 harness controls                               | N5/N6 supply supported capability and policy contracts. Unsupported native controls stay visibly unsupported.                                                              |
| 141 and 308–310 usage                              | Attribute usage to attempts/nodes without double counting, preserving the existing usage/account owner. Source manifests and rate limits need their own provider evidence. |
| 139, 169 and 186 Git/PR interactions               | Rewire run context and linked PR state through established Git ownership. Preserve delivered review submission and sync; remaining forge features stay named.              |
| 171 rich composer                                  | N9 fixes the intent/run binding using the current editor. Singapore composer adoption and widget prerequisites remain independent.                                         |
| 172 shared undo                                    | Durable commands may integrate through its action contract. Preserve the editor undo graph and server journal. No transcript rewrite to simulate undo.                     |
| 316 attention and push notices                     | Derive waiting, running and background state from new server truth. Preserve scope-bearing session links and notification ownership.                                       |
| 181 timeline anchoring                             | New item identities/revisions feed the existing scroll owner. Record baseline anchoring and expansion before replacing rows.                                               |
| 187 setup scripts                                  | Prepared runs expose workspace readiness and cancellation while scripts remain visible in owned terminals.                                                                 |
| 209 unified workspace                              | Keep its design gates. This rewrite does not authorize a pane redesign or broaden worktree state-loss permissions.                                                         |
| 114 installed clients, 132 service ownership       | Shared machine service and retained terminals survive client closure. Native macOS host renders web; `apps/mac` is an editor stub, not a second native chat stack.         |
| 202 TUI                                            | Consume new shared contracts and projection owners. Keep terminal-specific interactions; web notices and dialogs are not parity requirements.                              |
| 337 devices and remote environment owners          | Preserve scoped access, existing pairings and revocation gates. Environment ID is part of every cross-machine owner key.                                                   |
| 286/287 terminals and 099 documents                | Rebind owned resources without changing terminal engine or document architecture. Their active structural work must not share writers with this cutover.                   |

Non-chat provider consumers include commit-message generation and agent reviews in
`apps/server/src/app.ts`. Checkpoint hunk queries also consume engine workspace/read-model access.
Update/restart uses busy-session APIs, push uses shell events, and
`apps/server/src/machines/remote-scripts.ts` reads the websocket contract. Migrate those callers
before removing the provider service or old engine exports.

MCP currently exposes workspace information and file reads, with provider grants tied to session
and runtime ownership. New orchestration-control tools, scheduled tasks, remote preview/device
operation families, and distribution additions require explicit operation inventory and owning units.
Record these nightly capabilities in N0. Do not assume either blanket absence or complete adoption.

## Execution order

All units below are **Approved and deferred**. Each launch fixes exact file owners, commands,
inputs, acceptance cases, and deletions. One structural cutover runs at a time. Preparation and
provider source research can run independently where they share no writers.

| Unit | Deliverable                                                                                       | Depends on                | Size |
| ---- | ------------------------------------------------------------------------------------------------- | ------------------------- | ---- |
| N0   | Fresh nightly operation inventory, retained-work transfer, fixture baseline, design qualification | Resumption                | M    |
| N1   | Domain schemas, identity map, client/internal command policy, storage design                      | N0                        | L    |
| N2   | Durable commit, run projections, receipts, effect outbox and ordered publication                  | N1                        | L    |
| N3   | Keyed command admission and message/run intake with atomic dispatch outcomes                      | N2                        | L    |
| N4   | Durable effect worker, startup recovery, cancellation and shutdown                                | N2, N3                    | L    |
| N5   | Provider adapter contract and Codex/Claude complete run path                                      | N3, N4                    | XL   |
| N6   | Requests, steering, provider changes, child/background work and context handoff                   | N5                        | XL   |
| N7   | Checkpoint, deletion, launch/setup, settlement and resource cleanup                               | N4, N5, N6 where needed   | L    |
| N8   | Shell/detail wire contracts, shared client owner and sequence recovery                            | N2, N3, N5                | L    |
| N9   | Web composer, durable queue, timeline and pending-request integration                             | N6, N7, N8                | XL   |
| N10  | TUI, native-host and remote-environment contract acceptance                                       | N7, N8, N9                | L    |
| N11  | Remaining providers and whole-product nightly capability reconciliation                           | N5, N6; named owner gates | XL   |
| N12  | Remove old orchestration, qualify the full release and close the migration                        | N0–N11 engineering scope  | L    |

N2–N8 develop against the fixture runner until an end-to-end replacement can switch server and
clients together. Use a migration branch or coherent stack with explicit temporary build breakage
if needed. Production does not acquire a dual-write path, v1 endpoint, compatibility bridge, or
feature flag selecting two engines. Every merged unit must meet its own declared gate.

### N0: Establish a new acceptance inventory

Create a fresh nightly operation map under `plans/343-t3code-nightly/`. Inventory the command
union, internal-only commands, websocket RPCs, HTTP snapshot/detail methods, provider capabilities,
UI entry points, and lifecycle operations. Derive operations from schemas and reachable callers.
A regex listing all `type` literals mixes commands, events, and data variants and is insufficient.
Trace runtime authorization as well as union membership. Nightly
`orchestrationV2.ts` includes server-internal-looking variants in its main command union;
Fregat must keep synthetic completion, settlement and recovery commands off the client boundary.

For each operation record upstream file/symbol, Fregat owner and entry point, defaults, result,
persistence and navigation effects, negative paths, acceptance cases, retained Plan 126 rows, and
status. Use unreviewed, source-reviewed, fixture-verified, and host/account-verified states.
A broader row stays open when only one case is verified. Do not use a percentage score.

Capture current behavior with the real database and external-provider fixtures, then read
nightly's corresponding tests and fixture observations. Include known-good controls before
investigating failures. Record legitimate Fregat differences and stronger protections.

Qualify candidates A and B on one complete send, atomic commit, provider effect, event ingestion,
and process-loss recovery case. Compare code ownership and instruction counts where useful.
No architecture timing claims come from a noisy shared host. Keep a written synthesis decision.

Acceptance: every command/RPC is accounted for exactly once, internal commands cannot pass client
validation, the source pin audit passes, and each retained open row has an owner. Existing fixture
baseline commands below exit 0, or a concrete failure is reproduced and assigned before cutover.

### N1: Define the new domain and remove ambiguous states

Trace each upstream domain schema and its consumers. Map app thread to local session, while
preserving environment/project/worktree identities. Add run, attempt, node, request, item and
effect IDs where required. Provider session/thread/turn IDs remain native references.

Specify lifecycles as discriminated unions with explicit transitions. Prepared work differs from
queued work; starting differs from running; waiting for input differs from completed background
work. Persist queue order, launch strategy, context references, and attempt lineage where nightly
uses them. Separate client commands from internal provider/recovery commands in runtime schemas.

Design projection tables and indexes for control reads, shell rows, detail pages, run history,
requests, and effect claims. Specify schema-derived wire types and structured errors. Keep current
intent fingerprint rejection and server-authoritative timestamps. Preserve scope-bearing IDs in
selectors and keys rather than translating every provider identifier into one session string.

Acceptance: contract tests reject impossible state combinations and internal command spoofing.
An identity table shows each owner and scope, including two environments with the same session
identifier. Unit N1 declares the exact existing contracts and tests superseded at cutover.

### N2: Commit events, projections, receipts and effects atomically

Replace the old persistence path in an isolated database. A single commit method reserves the
command outcome, appends events, updates projections and turn-item positions, records durable
effects, and finalizes the receipt. Rejection persists the rejected intent where required.
Receipt lookup verifies the command fingerprint before returning a previous result.
Commands with no state change still retain a receipt, protecting Stop and settlement replay.
Project and session events share an application sequence. Filtered subscriptions can legitimately
skip numbers, so gap recovery uses replay bounds and readiness markers rather than subtraction.

Separate event history, query projections, raw/native ingestion identity, and effect execution
state. Give effects deterministic IDs and explicit pending/running/succeeded/failed/cancelled
states. Define scope-based claim and cleanup indexes. Use minimal control reads rather than
loading the entire transcript to decide whether work can run.

Guarantee ordered postcommit publication when owner lanes commit concurrently. The nightly
`EventSink.ts:232` explains why transaction order alone does not guarantee publish order.
Subscribers must see committed updates in sequence order, including provider-generated writes.

Inject failures before receipt reservation, after event append, after projection write, after
outbox enqueue, and immediately after commit. Compare SQL rows directly. A rollback leaves no
partial outcome. A crash after commit retains sufficient durable work for N4 to classify it.

Acceptance: retrying a committed command returns the same result without extra event/effect rows.
Changed intent rejects. Fresh projection rebuild equals the live projection for the corpus.
Publication scheduling perturbations cannot hide an earlier committed event.

### N3: Make run intake and owner concurrency explicit

Replace the global command queue with keyed ownership that serializes conflicting reads and
commits. Project deletion, fork, and cross-session work acquire the affected owners in a stable
order. Registry discovery and metadata writes follow the same identity rules.

Implement durable message intake and run creation. Classify append, queue, steering, prepared
launch, edit, cancel, reorder, interrupt, and request-response commands from nightly source.
Availability and queued behavior are decided server-side. A queued prompt survives a tab closing,
and two owners cannot both drain it. Retain uploaded/context attachment claims through admission.

Atomic command results expose committed sequence and domain identities. They do not claim a
provider has executed. Keep finite admission and structured rejections for invalid lifecycle,
unsupported capability, deleted owner, unavailable workspace, and stale request context.

Acceptance: two commands for one session cannot plan from the same stale state. A long external
operation in session A does not hold admission for unrelated B. Delete versus intake, fork versus
checkpoint, and queue edit versus dispatch have deterministic outcomes and retained content.

### N4: Run and recover durable effects

Implement effect claiming, execution, settlement, cancellation, and process ownership. Use an
owned worker lifetime with bounded retained work. Domain decisions enqueue effects; workers
perform external work and publish normalized outcomes. A canceled caller wait leaves the actual
execution result observable. Claim and settle with lease tokens using atomic SQL predicates.
Lifecycle effects execute in owner order even while an earlier effect is waiting for retry.
Checkpoint rollback must finish before a later provider start. Title metadata has a separate
owner lane. Bounded retry scheduling is durable and final failures retain a visible outcome.

Port the process-loss classifications from `EffectOutbox.ts`, then qualify each local effect.
Restart recovery clears process-bound work without resending a turn. Replay-safe continuation,
detach, checkpoint, cleanup, title, and delegated-stop behavior still needs an idempotent local
contract. Do not interpret the label as proof an external side effect is exactly-once.

Startup recovery terminalizes lost-process work, reconciles delegated completion bookkeeping,
then starts effect workers. A continuation worker cannot race unsettled child results.
Startup closes orphan attempts, reconciles provider-owned work, preserves pending durable intent,
and holds queues where nightly requires explicit resume. Continuation creates its own lineage.
Background work canceled by restart has an explicit record and later prompt context as supported.
Shutdown stops admission and records the state required for the next startup.

Acceptance: kill a fixture process at every claim/execute/settle boundary. There is no duplicate
prompt or request answer. Replay rebuild sends no provider command. A failed cleanup remains
visible and retains the resource needed for safe diagnosis. Subscriptions and workers dispose.

### N5: Port the provider boundary through a complete run

Inventory each currently delivered provider and nightly adapter. Start with Codex and Claude
because their local native fixtures and production paths already exist. Specify capability
descriptors, provider references, start/resume/continue/steer/interrupt/request-response behavior,
usage attribution, error mapping, and child/background event normalization.

Change the local provider service and directory together with the orchestrator. Persist the
attempt/native ownership needed to reject stale events. Recheck active-attempt and provider-thread
ownership inside the event commit transaction; a pre-normalization in-memory check is insufficient.
A provider process may host several native threads. Distinguish process-wide pending work for
idle release from thread-specific pending work for run completion. Reuse one injected authoritative
provider registry rather than constructing a second owner during orchestration bootstrap. Keep external protocol handling inside
adapters. Validate raw events once, retain required correlation, and produce domain events with
stable IDs. Coalescing and buffering must preserve item revisions, tool outcomes, completion,
request boundaries, and provider errors.

Test start failure, late completion after Stop, provider restart, request overlap, resumed history,
model-option selection, context size failures, rate limits, and event duplication/reordering.
Run existing native fixture binaries with the new core. Provider-free transcript replay is useful
for event normalization; it cannot replace start/resume/request delivery tests.

Acceptance: one real in-process fixture path reaches send, provider attempt, content/tool event,
request answer, completion, restart recovery and resumed turn. Both drivers pass their supported
cases. Account smoke remains a separately recorded receipt with no fabricated coverage.

### N6: Port requests, steering, switching and delegated work

Bind approvals and questions to request, node, attempt and generation. A response includes the
supported provider answer shape and attachment ownership. Two tabs resolve the request once.
An expired request cannot be answered by a later run. Persist acknowledged and rejected outcomes.

Port queued work, immediate steering, provider/model changes and restart selection according to
nightly command policy. Selection changes have explicit native-session consequences. Preserve
supported options and visibly explain blocked controls with existing structured errors.

Represent subagents and background tools as owned nodes with launching-run lineage. Record
nested requests, usage and task completion separately from root completion. Port delegated result
cohorts and completion delivery without duplicate wake prompts. Stop targets supported descendants
and background work. Context handoff and fork retain source point and transferred content identity.

Acceptance: queued A/B, request-held dispatch, immediate steer, model change, Stop, child finish
and restart races match the declared corpus. No active child is hidden by root completion, and a
late child cannot revive deleted work. Complete context delivery occurs once to its intended owner.

### N7: Rebind lifecycle, checkpoints and retained resources

Port launch/preparation, workspace strategy, setup failure/retry, settlement, archive, snooze,
ordering, fork, rewind and deletion through the new run model. Keep existing Fregat worktree and
terminal owners. Their resource lifetimes are broader than a browser view or one run.

Checkpoint capture belongs to an explicit scope and run boundary. Restore checks repository,
worktree, provider rollback support, concurrent work, and protected files before destructive
steps. Preserve Fregat's existing stronger safety behavior where nightly semantics permit it.
Deletion commits a tombstone and cleanup intent, then performs provider, terminal, preview and
attachment cleanup with durable outcomes. Failed cleanup must not erase its diagnostic state.

Port PR linkage/watch/context through existing Git owners. Delivered forge interaction behavior
gets regression cases; unimplemented forge families stay in their named feature batches.

Acceptance: interrupted setup, failed checkpoint, deletion during provider startup, failed-current
selection, partial bulk failure, nested worktree ownership, restart during cleanup, and two-owner
rewind pass. Closing a client leaves unrelated terminals and the shared machine service alive.

### N8: Deliver authoritative shell/detail state through one client owner

Define bounded shell and detail projections, item revisions and paging. Trace nightly HTTP snapshot
and websocket stream startup together. Specify sequence/cursor handling, subscription readiness,
loss recovery, reconnect, wake/foreground refresh, and eviction with actual owner keys.

Move common orchestration lifecycle into `packages/client-core` when both web and TUI need it.
Current web and TUI lifetimes are separate even though writers are shared. Collapse duplicated
supervisors only after both callers can use the same domain contract. Keep environment identity
in every owner/cache key. Do not move feature-aware command enablement into a generic library.

Reads use TanStack Query, including imperative queries. Commands and cache settlement use TanStack
mutations or the existing documented intent-queue exception. Socket notification is additional
settlement, not permission to leave caches stale. Streaming transport has explicit lifetime and
bounded retention outside request caching. Components subscribe to narrow selectors.

Acceptance: event during snapshot handoff, duplicate delivery, projection gap, reconnect after
commit/lost response, fresh tab with stale persisted view state, paging during updates, and route
switching produce authoritative state. Old subscriptions dispose and cannot write into a new owner.

### N9: Switch the web composer and timeline together

Bind drafts, uploads, context, prompt stashes and queued run intent to environment/session/run.
One mutation owner creates intake. Draft promotion and uncertain acknowledgement retain user
content until a durable receipt and authoritative state confirm ownership transfer.

Render new items, attempts, requests, child/background work, usage, proposed plans, notifications
and checkpoints through existing chat components and shared primitives. Preserve copy, focus,
keyboard/alternate-send behavior, editing, expansion, scroll anchoring, Markdown isolation and
accessible narrow layouts. Queue edit/remove/reorder/cancel and Stop recovery need reachable UI.

Do not start the Singapore composer replacement or workspace redesign to make this cutover possible.
Use the current composer as the consumer. Revisit their contracts in their own plans.

Acceptance: fresh draft first send, in-flight attachment upload, Stop before ACK, failed dispatch,
reload, route switch, two tabs, and two environments preserve every prompt and attachment once.
Timeline item order and work grouping stay stable during delta coalescing and replay. Required
browser scenarios, screenshots, cache settlement evidence, and render measurements pass.

### N10: Qualify TUI, native hosts and remote ownership

Migrate TUI command and projection consumers together. Render supported new run/request/background
state in terminal-native controls. Use TUI fixtures and one interactive CLI session where available.

The installed native webview consumes the web client. Verify startup, close/reopen, server reuse,
terminal retention and restart on supported installed hosts. `apps/mac` remains editor-first and
requires no invented native chat migration. Refresh host availability before claiming OS coverage.

Qualify two remote owners with colliding session IDs, one disconnected owner, reconnect, scoped
command authorization, and transport errors. Existing pairing credentials retain their scopes.
Changing required scopes or revoking/replacing owner device records retains its owner gate.

Acceptance: web and TUI use one contract revision, isolated native/remote cases pass, and no
consumer requires the old command/event schema. Physical-device and unavailable-host gaps are named.

### N11: Reconcile every remaining provider and nightly product operation

Map nightly's Codex, Claude, OpenCode, OpenCode2, Cursor, Grok, Antigravity, Pi, Muse, and ACP registry
families to Fregat's delivered adapters, current provider plans, and supported external systems.
Recheck this list against the pinned registry at launch. A package's existence is insufficient
proof of a reachable adapter. Exact account setup, install, model discovery, authentication,
filesystem requests, resume, cancel, native options and errors are provider-specific.

Transfer Plan 126's Grok/Antigravity and supported-driver follow-ons into explicit adapter batches.
Retain current driver deliveries and add their regression coverage. New families need an owner,
capability contract and native fixture before production wiring. No silent blanket exclusion.

N0's whole-product inventory also records scheduling, workflow inspection, orchestrator MCP,
preview/browser/device tools, remote access, mobile and distribution. Adopt a capability through
its existing product owner or a named later unit with concrete scope and gates. Orchestration
identity, authorization and completion mapping belongs here even when UI delivery is later.

Acceptance: every provider/capability row names a disposition, executor, dependency and evidence
limit. Core delivery can close its engineering scope with owner-only account/device receipts
open, but cannot claim whole-product nightly alignment while required implementation remains.

### N12: Delete the old path and qualify the release

Switch server and all shipped clients together, then delete obsolete contracts, tables in isolated
state, decider/projector branches, reactor wiring, duplicated read models, client supervisors and
tests that encode replaced behavior. Retain reusable pure policies only with migrated callers.
Keep no compatibility aliases or obsolete command families for older clients.

Reconcile the September manual comparison runners. Preserve old artifacts as historical records.
Retire extractors whose source disappeared and create new nightly cases with new provenance.
The new operation map must distinguish runtime-verified scope from source-reviewed requirements.
Legal attribution and borrowed-source notices remain with retained code.

Run the relevant full suites and gates once after narrow unit checks pass. Build one portable
release and verify that exact release with isolated fixture state. Present the qualified change,
state impact and target before any gated owner-state operation or install. After an authorized
install, confirm the served release commit, pending phase and live check, then run read-only
acceptance against the changed protocol and owned resources.

Acceptance: no caller reaches the old engine or schema, every engineering row has evidence,
remaining account/device gates stay explicit, source and reference checks pass, required normal
hooks/CI pass, and release behavior matches the qualified source. Mark this plan complete only
when its declared implementation scope and delivery gates are satisfied.

## State cutover and rollback

Develop and verify against disposable databases. Rebuilding a projection from event truth is
ordinary recovery; importing old-version event history to make both engines coexist is excluded.
The owner has valuable existing session history and production runtime state. This plan approves
no deletion or reset of it.

Before production cutover, record database/event/attachment/provider-session inventories without
content, qualify a backup and restore in isolated state, and present the concrete affected state
and retention choice. Resolve that owner-data decision after the rewrite is reviewable. Preserve
old state intact until that decision. Do not let automatic initialization destroy it on startup.
A planned isolated cutover can start from clean state without adding production migration code.

If the new system can retain existing state through a shared, current domain representation,
prove that directly. If it requires translating obsolete schemas, revise the state strategy with
the owner rather than inventing a compatibility importer. Existing pairing and remote authority
changes have their own explicit gates.

Rollback restores a matched previous release and its qualified state snapshot. Do not run an old
binary against a newly written schema or assume rolling back a bundle reverses package links.
An install remains a final delivery action after protocol and state qualification.

## Verification commands

These are execution gates for the future rewrite. This planning pass runs only reference/document
checks and normal publication hooks. Every command below runs from the repository root unless it
uses `--cwd`. Use the execution host's heavy-job workflow for expensive suites and builds.

| Gate                       | Command                                                                                                                                                                                                                                                                                                                      | Expected result                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Reference                  | `python3 -B plans/343-t3code-nightly/reference-audit.py --reference references/t3code`                                                                                                                                                                                                                                       | Inventory matches; tag and every source object match the nightly commit |
| Historical records         | `python3 -B scripts/parity/check.py`                                                                                                                                                                                                                                                                                         | Original ledger/provenance remains valid; no nightly inference          |
| Plan inventory             | `bun run plans:check`                                                                                                                                                                                                                                                                                                        | All top-level plans indexed; Editor inventory valid                     |
| Contracts                  | `bun run --cwd packages/contracts test -- src/tests/orchestration.test.ts src/tests/orchestration-ws.test.ts`                                                                                                                                                                                                                | Current and replacement schema acceptance cases pass                    |
| Engine/projection baseline | `bun run --cwd apps/server test -- src/orchestration/tests/engine.test.ts src/orchestration/tests/projection-replay.test.ts src/orchestration/tests/recovery.test.ts`                                                                                                                                                        | Real fixture state passes; failures are recorded before replacement     |
| Provider baseline          | `bun run --cwd apps/server test -- src/provider/adapters/tests/codex.test.ts src/provider/adapters/tests/claude.test.ts`                                                                                                                                                                                                     | Native fixture cases pass without live accounts                         |
| Shared client              | `bun run --cwd packages/client-core test`                                                                                                                                                                                                                                                                                    | Owner, reducer, transport and optimistic-intent behavior pass           |
| Web state baseline         | `bun run --cwd apps/web test -- src/features/chat/state/tests/follow-ups.test.ts src/features/chat/state/tests/session-detail-subscriptions.test.ts src/features/chat/state/tests/chat-input-draft-store.test.ts`                                                                                                            | Queue/draft/subscription cases pass under configured projects           |
| Changed package typechecks | `bun run --cwd packages/contracts typecheck`; `bun run --cwd packages/client-core typecheck`; `bun run --cwd apps/server typecheck`; `bun run --cwd apps/web typecheck`                                                                                                                                                      | No errors after the matching producers and consumers switch             |
| Whole-tree invariants      | `bun run gates`                                                                                                                                                                                                                                                                                                              | Required architecture, errors, async, array and unused checks pass      |
| Browser readiness          | `bun run agent:browser look --doctor`                                                                                                                                                                                                                                                                                        | Isolated API and client healthy, required assets load                   |
| User flows                 | `bun run agent:browser scenario chat-follow-up`; `bun run agent:browser scenario chat-queue-stop-upload`; `bun run agent:browser scenario approval-reconnect`; `bun run agent:browser scenario checkpoint-rewind`; `bun run agent:browser scenario server-restart`; `bun run agent:browser scenario monitor-draft-ownership` | Fixture flows pass; read back screenshots and name evidence directory   |
| Cache settlement           | `bun run agent:browser caches`                                                                                                                                                                                                                                                                                               | Relevant mutation outcomes and authoritative cache owners match         |
| Render/CPU comparison      | `bun run agent:browser renders chat-stream`; `bun run agent:browser trace chat-stream --compare <baseline-evidence-directory>`                                                                                                                                                                                               | Attributed before/after evidence; no unmeasured speed claim             |
| Final source qualification | `bun run verify`                                                                                                                                                                                                                                                                                                             | Relevant full suites, typechecks, formatting and generated checks pass  |
| Release build              | `bun run build-release`                                                                                                                                                                                                                                                                                                      | Portable matched release built and verified before gated installation   |

Update superseded baseline test paths at the unit that deletes them. Create replacement test files
beside their owners. Do not retain an obsolete test to preserve a command in this table.

Use server fixtures and real SQLite, repositories, files and transports. Mock external provider
boundaries, never local orchestration modules. Follow existing `engine.test.ts`,
`provider-runtime-epoch.test.ts`, `recovery.test.ts`, `rewind-admission.test.ts`, and
`session-deletion.test.ts`. Apps use configured Bun Vitest projects. Shared runtime-neutral packages
use their existing plain Vitest scripts.

Nightly's `FoundationPersistence.test.ts`, `EffectWorker.test.ts`, `RestartContinuation.test.ts`,
`SelectionRestart.integration.test.ts`, `SteeringCompletion.integration.test.ts`,
`DelegatedCompletionDelivery.test.ts`, and `testkit/fixtures/` supply case ideas and expected
observations. Read their actual implementation. Port a bounded corpus with attribution if needed.
Do not invoke live tests as part of loops, CI, or routine deployment checks.

Add `nightly-run-queue`, `nightly-restart-continuation`, `nightly-provider-switch`,
`nightly-delegated-completion`, and `nightly-two-owner-recovery` browser scenarios during the
corresponding units. These are planned scenarios, not commands available today. Put stable
selectors in `scripts/agent/selectors.ts`. Use the collaborative browser when it is available,
and the project's verification workflow for durable evidence.

## Acceptance matrix

Each row needs one fixture-backed case and negative-path assertions. Browser and native cases add
evidence for the affected consumer. Capture observed SQL/provider calls as well as UI state.

| Case                                                          | Required observation                                              | Unit    |
| ------------------------------------------------------------- | ----------------------------------------------------------------- | ------- |
| Repeated command                                              | One receipt, event batch and effect set                           | N2      |
| Reused ID, changed prompt intent                              | Structured rejection; original result stays intact                | N2      |
| No-op Stop replayed after later work                          | Original accepted receipt; later work remains active              | N2, N3  |
| Filtered application sequence jumps                           | Valid other-owner events do not trigger false loss                | N8      |
| Transaction fails at each write boundary                      | No partial projection, receipt or effect visible                  | N2      |
| Two sessions commit then publish in reversed scheduling order | Subscribers receive increasing committed sequence                 | N2      |
| Same-session concurrent commands                              | Second plans against committed first state                        | N3      |
| Independent-session slow effect                               | Other session admits and completes                                | N3, N4  |
| Earlier rollback retries while next start is queued           | Start waits; independent title metadata can progress              | N4      |
| Expired or replaced effect lease settles                      | Old worker cannot write another claim's result                    | N4      |
| Process dies before native start                              | Durable intent has explicit recovered status; no hidden loss      | N4      |
| Process dies after possible native start                      | No automatic duplicate prompt; explicit continuation policy       | N4, N5  |
| Rebuild projections                                           | Same authoritative projection; zero native calls                  | N2, N4  |
| Stale provider generation                                     | Cannot change current run, usage or requests                      | N5      |
| Provider start races deletion                                 | No orphan native owner or erased cleanup outcome                  | N5, N7  |
| Codex and Claude request answer                               | Correct native shape once, attached to originating attempt        | N5, N6  |
| Request answered from two tabs                                | One durable outcome and one provider response                     | N6, N9  |
| Queue A/B while busy                                          | Persisted order, supported boundary dispatch, request hold        | N3, N6  |
| Queue edit/cancel/reorder races dispatch                      | One deterministic command result with retained content            | N3, N6  |
| Stop during upload and uncertain ACK                          | Recover user content once; no duplicate run                       | N6, N9  |
| Switch model/provider with queued intent                      | New ownership explicit; supported options retained                | N6      |
| Nested child completes after root                             | Visible node outcome; one supported completion delivery           | N6      |
| Stop delegated/background work                                | Correct descendant targeting and final recorded outcomes          | N6      |
| Restart with unfinished background work                       | Explicit canceled-work receipt and qualified continuation context | N4, N6  |
| Context handoff and fork                                      | Correct source/run lineage, content and attachment claims         | N6, N7  |
| Prepared launch fails or cancels                              | Visible retry/cancel result, owned terminal/worktree preserved    | N3, N7  |
| Checkpoint rollback safety                                    | Protected or concurrently owned state refuses restore             | N7      |
| Delete cleanup fails then restarts                            | Cleanup intent and failed resource ownership survive              | N4, N7  |
| Snapshot/stream handoff                                       | No missing committed item or duplicate visible item               | N8      |
| Detail paging during new items                                | Stable order/revisions and bounded retained state                 | N8, N9  |
| Reconnect with lost response                                  | Receipt resolves intent; server projection wins                   | N8, N9  |
| Fresh draft first submit                                      | Correct promotion; no residual sent draft                         | N9      |
| Navigate during in-flight operation                           | Result stays with originating owner                               | N8, N9  |
| Two environments with colliding IDs                           | Separate commands, drafts, caches and native grants               | N8, N10 |
| Client close/reopen                                           | Shared server and unrelated terminals continue                    | N7, N10 |
| Retained provider support                                     | Current delivered controls retain their supported outcomes        | N5, N11 |
| Old source removal                                            | All shipped consumers use the new domain; obsolete owner absent   | N12     |

## Planning verification receipt, 2026-10-10

The source pin and object audit passes. The plan index and local links pass. Historical ledger
validation initially failed because ten scenario-verified rows named scenarios without their
full repository paths. The same failure reproduced at the untouched Fregat baseline. This pass
appends the existing scenario paths named in those receipts; every original field, pin, status,
and evidence entry remains intact. No scenario was rerun or promoted. The historical record
checker then passes with 47 contract modules, 146 RPC methods, and 57 finding groups.

A cold review checks source ownership and execution boundaries. Application tests, browser flows,
provider accounts and deployment are future execution gates; this documentation pass makes no
new runtime or performance claim. Normal publication-hook and CI results belong to the PR.

## Reference cleanup and evidence policy

The committed reference audit lists matching tracked files and new owned files by path and line.
It excludes its generated directory to avoid self-referential output. The categories are
current-direction, historical-alignment, frozen-comparison, implementation-or-attribution, and
context-reference. A category is a review destination, not a claim that every cited behavior was
re-audited. Retained source notices and licenses must stay intact.

The current reference guide, roadmap, plan index, Plan 126 entry point, historical gap/persistence
reports, active Plan 126 audit/provider entry points, and comparison guide now identify nightly
and its new owner. Dated delivery receipts, inventory, ledger, source hashes, and paired observations
keep their original pin. Remaining neighboring research references inherit the current guide;
recheck their exact scope when their owner starts implementation.

Rerun the inventory after changing references:

```sh
python3 -B plans/343-t3code-nightly/reference-audit.py --write
python3 -B plans/343-t3code-nightly/reference-audit.py --reference references/t3code
```

Review the inventory diff before accepting new classifications. Refreshing nightly writes a new
source pin and delta, then reopens affected source/fixture rows. It does not rewrite old receipts.
Runtime evidence records both subject revisions and corpus limits. A selected pure function,
source substring, successful compilation, or screenshot alone cannot close a whole lifecycle row.

## Stop conditions and risks

Pause the affected unit and update its plan when the nightly tag does not match the recorded
commit, the source owner has moved, or a claimed capability cannot be traced to a reachable caller.
Do not expand a replacement based on a stale absence claim.

A need to mutate production sessions, pairings, files, repositories or protected runtime state
retains its owner-data gate. Finish isolated implementation, qualification, and review first so
that decision concerns a concrete artifact and verified state strategy.

If replacing one framework requires duplicating supervisors, coercing errors, leaking native wire
schemas, or inventing an actor runtime, revisit N0's design. If effect recovery cannot distinguish
whether a prompt happened, preserve the uncertainty and require explicit recovery intent.
Do not add an automatic retry to conceal it.

The largest risks are duplicate native effects, incorrect request ownership, forgotten delivered
capabilities, unbounded projection retention, unsafe cleanup and drift during the long rewrite.
Atomic durable intent, explicit process-loss classifications, a complete operation inventory,
fixture crash-window tests and one matched producer/consumer cutover address those risks.

## Done criteria

- [ ] N0 records every nightly command, RPC and retained product operation with an owner.
- [ ] N1's domain map and design qualification are reviewed against current source.
- [ ] Events, projections, receipts and effects commit together with ordered publication.
- [ ] Run/attempt/node/request/item ownership passes restart and concurrency cases.
- [ ] Delivered providers and product behaviors have retained regression coverage.
- [ ] Web and TUI share qualified contracts and the needed client lifecycle ownership.
- [ ] Old engine, superseded schema and duplicate lifecycle plumbing have no callers.
- [ ] Narrow checks, required browser evidence, normal hooks and changed-scope CI pass.
- [ ] The state cutover and matched rollback strategy are qualified before any owner-data action.
- [ ] The authorized release is served and verified, or the remaining delivery gate is explicitly open.
- [ ] Historical references retain provenance; new nightly evidence names exact source revisions.
- [ ] Remaining accounts, physical devices and separate product batches are named with their gates.
