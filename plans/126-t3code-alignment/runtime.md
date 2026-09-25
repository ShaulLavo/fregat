# Runtime, providers, persistence, and transport

Baseline: Platform `3c9b88c35784e571e706600b0cee8e95a2656f77`; T3 Code `7445aa733ada33e45289e5aa5055f79142556513`. All upstream citations below refer to the pinned commit, read with `git -C references/t3code show <commit>:<path>`, not its older checkout. The local files cited had no diff from the Platform baseline in this scope. This is a two-pass source audit, not a live-provider equivalence claim. No application code, running process, credentials, or deployment was changed.

## Coverage and operation inventory

| User path / runtime concern              | Upstream source anchor                                                                                  | Local source anchor                                                                                         | Assessment                                                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Select provider / account instance       | `apps/server/src/provider/builtInDrivers.ts:49`; `provider/Layers/ProviderRegistry.ts:11`               | `apps/server/src/provider/drivers/built-in.ts:17`; `provider/provider-adapter-registry.ts:448`              | Multi-instance infrastructure exists; four production drivers absent (RUNTIME-02).                                                                                                        |
| Model capabilities and options           | `provider/Layers/CodexProvider.ts:176`                                                                  | `provider/adapters/codex.ts:2722,2847`; `packages/contracts/src/provider.ts:73`                             | Partial; advertised service tiers/options are narrowed (RUNTIME-06).                                                                                                                      |
| Auth / account setup                     | `provider/Layers/ProviderAuthService.ts:76`; individual driver return objects                           | `provider/routes.ts:57`; `provider/adapters/claude.ts:269`                                                  | Claude login/status/cancel/logout routes exist. Driver-specific login parity remains unverified; do not infer universal in-app Codex login from generic upstream auth contracts.          |
| Import/discover and resume history       | `apps/server/src/project/AgentSessionImporter.ts:99,208,222`; `provider/Layers/ProviderService.ts:1238` | `orchestration/session-discovery.ts:265`; `provider/provider-service.ts:565,1008`                           | Comparable ownership guards and resume persistence exist; different IDs/frameworks are not defects. Exact scan coverage/defaults require runtime comparison.                              |
| Send / queue / retry / steer / interrupt | `orchestration/Layers/ProviderCommandReactor.ts:1206,1408`; `provider/Layers/CodexSessionRuntime.ts`    | `orchestration/provider-command-reactor.ts:285,405`; `provider/adapters/tests/codex.test.ts:1516,1555,1579` | Recent steer/Stop/late-completion repairs exist. Manual compaction and its follow-up queue are missing (RUNTIME-05). General composer queue ownership belongs to interaction audit.       |
| Native approvals and questions           | `provider/Layers/CodexSessionRuntime.ts:2056,2170,2235,2298`                                            | `provider/adapters/codex.ts:778,808,866,3123`                                                               | Command/question native correlation exists; MCP app-access forms missing and permission response shape wrong (RUNTIME-03,11).                                                             |
| Child normalization / ownership          | `provider/Layers/CodexSessionRuntime.ts:1116`; `orchestration/ThreadBackgroundLiveness.ts:104`          | `provider/adapters/state/codex-child-agents.ts`; `provider/adapters/tests/codex.test.ts:1473,1555`          | Child request/turn ownership and Stop repairs present. Background liveness is not supplied to idle reaping (RUNTIME-07).                                                                  |
| Shell/detail snapshots and reconnect     | `apps/server/src/ws.ts:1969`; `orchestration/LiveStreamBudget.ts:9`                                     | `orchestration/streams.ts:145,342,395`; `orchestration/ws-rpc.ts:269`                                       | Cursor replay/snapshot fallback exists; retained delivery is unbounded (RUNTIME-04).                                                                                                      |
| Assistant delivery policy                | `packages/contracts/src/settings.ts:1061`; `orchestration/Layers/ProviderRuntimeIngestion.ts:1996,2042` | `orchestration/provider-runtime-ingestion.ts:76,292`                                                        | Token-like default vs upstream paragraph default; no reachable mode setting (RUNTIME-09).                                                                                                 |
| Checkpoints / rewind                     | `orchestration/Layers/CheckpointReactor.ts:813`                                                         | `orchestration/provider-command-reactor.ts:501`                                                             | Capture/diff/prune exist; destructive restore ordering and conversation-only rewind diverge (RUNTIME-01).                                                                                 |
| Recovery / cleanup                       | `provider/Layers/ProviderService.ts:1238`; `provider/Layers/ProviderSessionReaper.ts:37`                | `orchestration/engine.ts:622`; `provider/provider-session-reaper.ts:67`                                     | Recovery claims/epochs and paged transactions exist; automatic continuation after update and all crash windows are unverified. Idle cleanup timing/background guard diverge (RUNTIME-07). |
| Usage limits / reset credits             | `provider/Drivers/CodexDriver.ts:285`; `apps/server/src/ws.ts:2390`                                     | `provider/adapters/codex.ts:1355`; `packages/contracts/src/provider.ts:105`                                 | Rate events alone do not provide account usage/credit workflow (RUNTIME-08).                                                                                                              |
| Provider update maintenance              | `provider/providerMaintenanceRunner.ts:305`; `apps/server/src/ws.ts:2382`                               | `provider/routes.ts`; `packages/contracts/src/provider.ts:105`                                              | No corresponding reachable update operation/state (RUNTIME-10).                                                                                                                           |

Upstream paths shortened to `provider/…` or `orchestration/…` in tables mean `apps/server/src/provider/…` or `apps/server/src/orchestration/…`. Findings below use complete paths.

## Actionable findings

### RUNTIME-01 — Validate rewind before touching files, and separate conversation rewind

- **Closed 2026-09-25** on the `checkpoint-rewind` scenario; the paired upstream run is dropped. Claude rewind waits for Plan 145 fork. See the ledger.

- **Status / priority / confidence:** Confirmed mismatch; P1; HIGH.
- **Evidence:** Upstream `apps/server/src/orchestration/decider.ts:1798-1816` distinguishes conversation rewind with `restoreFiles:false`. `apps/server/src/orchestration/Layers/CheckpointReactor.ts:813-835` checks provider rollback support first and rejects file restore in a non-isolated workspace. Local `apps/server/src/orchestration/decider.ts:209-215` checks only that the session is not archived; `provider-command-reactor.ts:523-539` restores files before asking the provider to rewind. Local `apps/server/src/provider/adapters/claude.ts:332-333` explicitly rejects rollback. `provider/provider-service.ts:619-627` can also reject a missing binding after files were changed. Local context resolves the owning worktree but performs no isolation check at `provider-command-reactor.ts:785-824`.
- **Impact:** A Claude or unavailable-runtime rewind can change files and then fail, leaving the transcript unchanged. A root/shared-checkout rewind can overwrite another session's changes. Users cannot rewind conversation alone.
- **Effort / risk:** L; HIGH because transcript, native history, checkpoint refs, and working files must remain coherent.
- **Implementation boundary:** Contracts command/event schemas → decider → provider capability/preflight → checkpoint reactor → UI intent. Add an explicit conversation-only command or typed restore choice. Validate ownership, supported rollback and workspace isolation before side effects; preserve project/worktree/environment identity. Coordinate composer restoration with interaction audit. Do not call a shared checkout isolated merely because the session points to a worktree row.
- **Dependencies:** Capability contract; interaction rewind controls. No dependence on missing providers.
- **Acceptance / tests:** Real Git fixture with two sessions sharing a checkout: conversation-only rewind preserves tracked/untracked bytes, index and other session history; file restore is rejected. Claude unsupported rollback and a missing binding leave all bytes/refs/history unchanged. Isolated Codex rewind restores the target and prunes only later history/refs. Extend `apps/server/src/orchestration/tests/checkpoint-reactor.test.ts:205` using real server/Git and native-process boundary injection; cover provider error before and after preflight. Upstream ordering itself is not a promise of transactional rollback across Git and provider failures.

### RUNTIME-11 — Return the native permission-approval response shape

- **Status / priority / confidence:** Confirmed mismatch; P1; HIGH. Added in pass two.
- **Evidence:** Upstream `apps/server/src/provider/Layers/CodexSessionRuntime.ts:2235-2294` retains permission requests and returns `{permissions: requestedProfile}` on acceptance, `{permissions:{}}` on denial, plus `scope:'session'` for session acceptance. Local `apps/server/src/provider/adapters/codex.ts:3129-3130` labels that method command approval; `codex.ts:778-783` answers every approval with `{decision}`. The native request method/profile is not retained for response serialization. Local `apps/server/src/provider/adapters/tests/codex.test.ts:1473-1512` checks command approvals and question answers, not permission grants.
- **Impact:** A permission request can render and be marked resolved locally while its native reply does not match the provider's required grant schema.
- **Effort / risk:** M; MED because approval ownership and provider-specific serialization are sensitive.
- **Implementation boundary:** Discriminated pending native request records in the Codex adapter; keep original native request ID, requested profile, child owner, and request kind. Serialize each method's native response at that boundary, not in UI/shared generic approval code. Keep command/file legacy methods' existing formats.
- **Dependencies:** None; should precede RUNTIME-03.
- **Acceptance / tests:** Inject parent and child permission requests; accept, deny, and accept-for-session produce exact upstream response objects under the original JSON-RPC ID, and exactly one resolved event. Duplicate/stale responses cannot grant a different request. Run the real adapter→ingestion→projection test with only the Codex process injected.

### RUNTIME-04 — Bound retained live delivery and recover from overflow

- **Status / priority / confidence:** Confirmed structural mismatch; P1; HIGH. Memory consequences need measurement, not an invented benchmark.
- **Evidence:** Upstream `apps/server/src/orchestration/LiveStreamBudget.ts:9-10,79-93,131-181` caps retained items at 1,000 and serialized bytes at 8 MiB, including batches waiting for ACK. It is wired into shell delivery at `apps/server/src/ws.ts:1984-2018` and detail coalescing in `apps/server/src/orchestration/ThreadLiveEventCoalescer.ts:103`. Local `apps/server/src/orchestration/streams.ts:158-183` grows a subscriber queue without a cap; `apps/server/src/orchestration/ws-rpc.ts:277-284,382` sends without awaiting/observing delivery pressure. `packages/client-core/src/transport/subscription-queue.ts:1-19` is also unbounded.
- **Impact:** Slow consumers have no equivalent application-level retained-data budget or deliberate resume-on-overflow behavior. A bounded replay tail does not bound per-subscriber or socket delivery retention.
- **Effort / risk:** L; HIGH because dropping deltas without forcing resynchronization corrupts visible state.
- **Implementation boundary:** One item+byte budget per subscription covering queued, coalesced and in-flight data; observable delivery completion/ACK or transport drain; release on abort/error; typed overflow forces replay/snapshot from last applied cursor. Bound client queue too. Preserve current RPC transport; Effect adoption is unnecessary.
- **Dependencies:** Existing cursor/snapshot protocol, not a new persistence design.
- **Acceptance / tests:** Stall consumer/ACK, publish many small and one oversized event, and prove retained budget stays bounded, listeners detach and memory references release. Resume at last applied sequence with no missing/duplicated text. Cover shell and detail, abort while waiting for ACK, cross-epoch reconnect, and concurrent snapshot publication. Existing local `streams.test.ts:115,151,218` covers cursor behavior but not this delivery budget.

### RUNTIME-03 — Route the supported MCP app-access elicitation forms

- **Status / priority / confidence:** Confirmed missing native path; P1; HIGH.
- **Evidence:** Upstream `apps/server/src/provider/Layers/CodexSessionRuntime.ts:2170-2231` opens correlated approvals for supported `mcpServer/elicitation/request` forms and translates the result. Local `apps/server/src/provider/adapters/codex.ts:866-871,3123-3136` accepts only the enumerated approval/question methods and returns JSON-RPC unsupported-method for elicitation. A downstream activity-kind mapping cannot make this native route reachable.
- **Impact:** Supported app-access approvals cannot complete through Platform.
- **Effort / risk:** M; MED, particularly persistence choice and native correlation.
- **Implementation boundary:** Native method parser and pending-request discriminant → contracts/projection → existing approval UI → method-specific reply. Preserve instance/session/child ownership and requested permission details; URL requests and recognized schemas with unpopulatable required fields decline. Unrecognized form schemas fall through to an accept response without content; preserve that source distinction.
- **Dependencies:** RUNTIME-11 native response modeling; interaction approval presentation.
- **Acceptance / tests:** Recognized app-access form offers only upstream-supported decisions, preserves one-time/session/permanent semantics and returns the expected native fields. Parent/child requests survive interleaved completion and resolve once. URL elicitations and recognized schemas with unpopulatable required fields decline. An unrecognized form schema returns acceptance without content after user approval; `CodexSessionRuntime.ts:430-475` distinguishes this from URL rejection. No app/server allowlist is present. Do not label a stricter unknown-schema policy as upstream parity.
- **Bounded absence search:** `elicitation`, `mcpServer`, and approval dispatch in `apps/server/src/provider`, `apps/server/src/orchestration`, and contracts; inspected the native request switch, not filenames alone.

### RUNTIME-02 — Add the four missing production provider drivers

- Decided 2026-09-25: owner — build all four drivers (Cursor, Grok, OpenCode, Antigravity). Smoke-test each where an account exists; otherwise ship it marked "untested". Missing accounts no longer block the row.
- **Status / priority / confidence:** Confirmed feature gap; P1 under full-alignment mandate; HIGH.
- **Evidence:** Upstream `apps/server/src/provider/builtInDrivers.ts:23-28,49-55` registers Codex, Claude, Cursor, Grok, OpenCode and Antigravity. Local `apps/server/src/provider/drivers/built-in.ts:17` registers Codex and Claude only. The local mock is test-only, and generic multi-instance types do not implement another runtime.
- **Impact:** Users of the four other upstream providers cannot execute, resume or configure those providers here.
- **Effort / risk:** L per driver; HIGH. This is four independently reviewable deliverables, not a single registry edit.
- **Research step (before each driver):** a short protocol survey per CLI (Cursor, Grok, OpenCode, Antigravity): how it streams events, how approvals reach the client and get answered, how sessions start and resume, and what upstream's driver does with each (`apps/server/src/provider/Drivers/<Name>Driver.ts`, `Layers/<Name>Adapter.ts` and `Layers/<Name>Provider.ts` at the pinned commit). One short note per CLI in this directory, written before that driver's code.
- **Implementation boundary:** Reuse local driver/instance registry. Port each pinned driver's supported auth, status/model discovery, invocation, normalized events, request replies, interruption, resume and lifecycle operations, including explicit unsupported outcomes. Do not require in-app auth or history import universally: upstream `packages/contracts/src/agentSessions.ts:6` and `apps/server/src/project/AgentSessionScanner.ts:1093` restrict external history scanning to Codex and Claude. Build adapter integration fixtures before UI exposure; then wire settings/model selection on each environment. Preserve provider instance identity through all events and storage.
- **Dependencies:** Capability descriptors (RUNTIME-06), native request model (RUNTIME-11/03 as applicable), existing settings registry. Provider-specific maintenance/auth belongs with its driver.
- **Acceptance / tests:** For each provider, configured enabled instance appears, starts a real in-process app turn using an injected external process boundary, streams completion/errors, resumes the same native conversation, and stops only its own runtime. Two same-driver accounts cannot share requests/cursors/credentials. Unsupported capabilities are unavailable in UI and rejected at server boundary. Real installed-provider smoke checks remain necessary before parity is claimed.
- **Bounded absence search:** Inspected `apps/server/src/provider/drivers`, `adapters`, production registry and provider contracts for `cursor`, `grok`, `opencode`, `antigravity`; no production driver registration/call path exists.

### RUNTIME-05 — Implement manual compaction with ordered follow-up handling

- **Status / priority / confidence:** Confirmed feature gap; P2; HIGH.
- **Evidence:** Upstream `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:1408-1476` rejects invalid/busy compaction, invokes compact, restores lifecycle, and queues follow-up messages until completion; failures cancel queued messages with explicit retry feedback. `apps/server/src/provider/Layers/CodexSessionRuntime.ts:2497-2499` calls `thread/compact/start`. Local adapter handles the `thread/compacted` notification at `apps/server/src/provider/adapters/codex.ts:1069,1416`, but there is no invocation path; local provider reactor only claims/sends ordinary turns (`provider-command-reactor.ts:285-328`).
- **Impact:** Observing automatic compaction is not the upstream `/compact` action. Users cannot reliably request it and send a follow-up under the same lifecycle guarantees.
- **Effort / risk:** L; HIGH due to interruption, queued intent and restart behavior.
- **Implementation boundary:** Recognize native compact command through composer/provider command dispatch; add capability/service adapter operation and explicit operation state. Serialize subsequent sends behind compaction; keep user messages and errors durably correlated without reusing a prior turn's ownership. Reuse local runtime epochs and intent scheduling.
- **Dependencies:** Interaction command menu path and existing queued-start recovery.
- **Acceptance / tests:** Empty conversation rejects; idle Codex compacts once; second compact while busy rejects; two follow-ups execute in order after success; compaction failure/Stop marks queued follow-ups retryable without sending them; restart during compaction does not replay the command or lose ownership. Claude and new providers follow their pinned adapter's supported behavior.
- **Bounded absence search:** `compactThread`, `compactSession`, `thread/compact`, `/compact`, `isCompact` in provider/orchestration/contracts/client-core/chat-mode; only notification handling, generated schema and test text, no callable manual path.
- **Measured 2026-09-25 (lane L3, before building):**
  - Codex 0.157 `thread/compact/start {threadId}` answers `{}` at once, then runs as an ordinary
    native turn: `turn/started` → `contextCompaction` item → `thread/tokenUsage/updated` →
    `turn/completed` (about 15 s on a one-turn thread). It sends no `thread/compacted`. So a
    manual compaction can be a Platform turn whose provider turn attaches on `turn/started`, and
    the existing busy/queue rules hold follow-ups behind it.
  - Claude: `compact` is in the probed command catalog, and a `/compact` user prompt through the
    SDK compacts: `compact_boundary` (`trigger: 'manual'`, pre/post tokens), a summary user
    message, `<local-command-stdout>Compacted </local-command-stdout>`, then a `result` with
    subtype `success` and empty text (about 20 s). It is a turn with a result like any other.
- **Delivered 2026-09-25 (lane L3):** `session.turn.start` takes `kind: 'compact'`. The decider
  rejects it on a session with no prompt (`COMPACT_EMPTY`) and, like any start, over a running turn
  (`START_STATE_CONFLICT`). Codex sends `thread/compact/start` and settles on the native turn it
  starts; its `contextCompaction` item becomes the timeline's "Context compacted". Claude sends
  `/compact` as the prompt. Because compaction is a turn, follow-ups queue behind it, Stop and
  failure settle it like a turn, and boot recovery marks it "Turn interrupted" without replaying.
  Tests: `orchestration/tests/session-fork.test.ts`, `provider/adapters/tests/codex.test.ts`.
  Scenarios `claude-manual-compaction` and `codex-manual-compaction` pass.

### RUNTIME-06 — Preserve advertised model option descriptors and service tiers

- **Closed 2026-09-25**: Plan 138 took the remaining Claude catalog work; `provider-model-options` scenario. See the ledger.

- **Status / priority / confidence:** Confirmed narrowing; P2; HIGH.
- **Evidence:** Upstream `apps/server/src/provider/Layers/CodexProvider.ts:176-211` exposes reasoning and service-tier select descriptors with provider IDs/defaults. Local `packages/contracts/src/provider.ts:73-77` represents reasoning/extended-thinking only; `apps/server/src/provider/adapters/codex.ts:2847-2859` discards other catalog capabilities and `codex.ts:2727-2733` reduces service tier to `fastMode === true ? 'fast' : undefined`.
- **Impact:** Non-fast advertised tiers and defaults cannot round-trip; controls are hardcoded instead of reflecting the selected model's capabilities.
- **Effort / risk:** L; MED.
- **Implementation boundary:** Typed descriptor contract and provider catalog mapping → client model controls → model-selection options → native adapter serialization. Use provider option IDs and defaults, removing old `fastMode` callers in the same pass. Keep existing Claude `contextWindow` support (`adapters/utils/claude-query-options.ts:121-125`); it is not absent merely because catalog descriptors are incomplete.
- **Dependencies:** Interaction model picker; prerequisite for RUNTIME-02 provider option coverage.
- **Acceptance / tests:** A fixture model advertising Standard plus two provider-specific service tiers shows all options and sends exact selected IDs. Changing model discards unsupported options and adopts new defaults. Unknown future effort strings still round-trip. No option registered without a native consumer.

### RUNTIME-07 — Make idle cleanup aware of background work and periodic

- Decided 2026-09-25: owner — recheck against Codex 0.157 is approved.
- **Status / priority / confidence:** Confirmed policy mismatch; P2; HIGH for missing guard/timer, MED for a particular silent-child termination scenario.
- **Evidence:** Upstream `apps/server/src/provider/Layers/ProviderSessionReaper.ts:75-95` excludes active turns and background liveness, and `:130-144` runs every five minutes after a thirty-minute idle window. `apps/server/src/orchestration/ThreadBackgroundLiveness.ts:104-149` distinguishes live nested agents/monitors from idle/completed tasks. Local `apps/server/src/provider/provider-session-reaper.ts:13,89-100` considers only `ready`, timestamp and launch/exemption; `provider/provider-service.ts:223` triggers it on a new runtime. Local parent completion sets `ready` at `provider/adapters/codex.ts:1832`. Event liveness refresh exists but is not a persistent background-work guard.
- **Impact:** Idle runtimes can remain indefinitely if no new runtime starts. A ready parent with background work producing no event for the idle interval can be reclaimed on the next launch, unlike upstream.
- **Effort / risk:** M; HIGH because an incorrect liveness model either kills work or retains processes forever.
- **Implementation boundary:** Feed native task/child lifecycle into per-session background liveness; supply it to reaper and a scoped periodic sweep. Count nested agents separately; classify monitor-only work; clear on runtime death, not on parent answer completion. Coordinate rail status with lifecycle audit without assigning it ownership of reaper policy.
- **Dependencies:** Existing child normalization; provider lifecycle cleanup.
- **Acceptance / tests:** Ready parent plus silent live child/monitor survives >30 minutes and another session launch. Idle/completed children no longer pin runtime. Truly idle runtime reaps without new launches. Long foreground turns, pending requests, concurrent resume and shutdown are never interrupted by sweep. Use injected clock/process factories; then inspect real process lifecycle.

### RUNTIME-08 — Publish account usage limits and wire reset-credit redemption

- Decided 2026-09-25: owner — build with boundary fixtures only. Nothing is spent until the owner does one live redemption.
- **Status / priority / confidence:** Fixture implementation complete; owner live redemption pending; P2; HIGH.
- **Evidence:** `provider/reset-credits.ts` persists account-scoped attempts in migration 38; `provider/adapters/codex.ts` rechecks native account identity and consumes the selected credit with the durable key. `features/chat/components/reset-credit-action.tsx` confirms the action and the mutation settles the usage cache.
- **Impact:** Codex account usage now includes a confirmed reset-credit action; ambiguous outcomes remain retryable with the same native attempt.
- **Effort / risk:** L; HIGH for a command that spends an account resource.
- **Implementation boundary:** Provider usage snapshot/refresh and account-keyed redemption service → contracts/route/mutation → interaction usage UI. Preserve account identity distinct from instance ID: instances sharing a credential home must share redemption serialization and pending idempotency. Do not put credentials into snapshots or logs.
- **Dependencies:** Interaction usage surfaces; provider instance identity already exists.
- **Acceptance / tests:** Account windows update after provider events and explicit refresh. Two instances for one account cannot consume twice concurrently; retry reuses the unresolved idempotency key. Disabled/unsupported instance cannot redeem. Refresh failure does not claim confirmed new limits. Use third-party/native boundary fixtures; no real credit consumption during automated verification.
- **Related plan:** Plan 141 (usage and rate limits) implements the quota surfaces and the usage page (EXT-17). This group keeps the upstream acceptance cases.
- **Verification:** Boundary fixtures cover account switches, cross-home concurrency, timeout/restart, persisted credit selection, malformed timestamps and equivalent-instant replay. The HTTP route and confirmation UI are exercised without live credit consumption.

### RUNTIME-09 — Match response delivery modes and paragraph default

- **Closed 2026-09-25** on the `response-delivery` scenario; the reasoning UX residue is Plan 160's reasoning fold (`chat-turn-anatomy`). See the ledger.

- **Status / priority / confidence:** Confirmed behavior/default divergence; P2; HIGH.
- **Evidence:** Upstream `packages/contracts/src/settings.ts:968,1061-1062` defines turn/paragraph/token with paragraph default. `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:1992-2003,2042-2071` applies project settings and never sends reasoning token-by-token. Local `apps/server/src/orchestration/provider-runtime-ingestion.ts:38,76,292-303` supports only constructor-level streaming/buffered and defaults to immediate delta dispatch. Searching `assistantDeliveryMode` through non-test server code finds no configurable consumer.
- **Impact:** Default answer delivery differs, and users cannot choose upstream turn/paragraph modes. This is an observable behavior finding, not an unmeasured speed claim.
- **Effort / risk:** M; MED because final-text deduplication and reasoning/message ordering must survive buffering.
- **Implementation boundary:** Registry-backed setting at appropriate project/window/environment scope; resolve it at ingestion; bounded paragraph/turn buffering using server clock; preserve final-only native events and child ownership. Reuse existing buffers, not a parallel event pipeline.
- **Dependencies:** Settings UI (root audit) and RUNTIME-04 retained-delivery budget.
- **Acceptance / tests:** Same event fixture yields exactly identical final text in all three modes, with expected intermediate paragraph/turn visibility. Reasoning remains buffered even in token mode. Completion, error, interruption, final-item-only response and reconnect flush/dedupe correctly; default new session visibly follows paragraph delivery.

### RUNTIME-10 — Expose capability-driven provider update operations

- **Status / priority / confidence:** Confirmed missing reachable feature; P2; HIGH for update path. Automatic installation breadth remains unverified.
- **Evidence:** Upstream `apps/server/src/provider/providerMaintenanceRunner.ts:305-339,347-357` checks per-instance maintenance capability and publishes queued/running state; `apps/server/src/ws.ts:2382-2385` routes it; `apps/web/src/components/ProviderUpdateEnvironmentRows.tsx:166,273` invokes it. Local provider routes and `packages/contracts/src/provider.ts:105-131` provide status/auth/catalog but no update capability, action or update progress state.
- **Impact:** Providers that upstream can update in-app require out-of-app maintenance here.
- **Effort / risk:** L; HIGH because replacing binaries interacts with active sessions and account-specific installations.
- **Implementation boundary:** Add driver-declared maintenance operation, instance/environment routing, serialized runner, bounded process/output lifecycle, snapshot progress and UI action. Follow pinned provider-specific supported/manual-only distinctions. Keep binary/package payloads and caches on configured data storage; do not install anything as part of this audit.
- **Dependencies:** Root settings/notifications audit; provider registry and production instance ownership.
- **Acceptance / tests:** Supported instance advertises update and executes its declared command once; unsupported/manual-only remains informative. Two requests serialize and observe shared state. Failure retains usable provider details; completion verifies installed version and refreshes catalog. Updating one environment never acts on another's binary.
- **2026-09-24 delta:** Post-pin `96c4bfa0` checks each harness's installed version against remote compatibility ranges (supported, graceful, unsupported) and `7e65b226` shares sign-in flows and credential bindings across instances. Version verification stays in this group. Plan 138 owns which Claude binary runs and the version the snapshot reports; do not build a second version probe. See [delta record](delta-2026-09-24.md).
- **Bounded search:** `maintenance`, `updateProvider`, `providerUpdate`, `installProvider`, `latestVersion` in local provider/settings/contracts/settings UI found no production maintenance route. This does not claim every upstream provider supports one-click install.
- **Delivered 2026-09-25 (lane L3):** `GET`/`POST /providers/:id/update` over `ProviderMaintenance`.
  The install method comes from the CLI's resolved path, as upstream decides it: the CLI's own
  `update` for a standalone install, `npm install --global --prefix <prefix>` or `bun add --global`
  where the path proves that owner. mise, Homebrew, the SDK-bundled Claude and unknown installs are
  manual-only and show their command. Homebrew is one-click upstream and manual here, because the
  keg path alone does not prove which `brew` owns it. The latest version comes from the npm
  registry, cached for an hour. Updates sharing an install run one at a time through a scoped
  mutation, and a queued click finds nothing left to do. After an update the adapter forgets its
  executable and the snapshot re-probes. Settings › Providers shows the installed version, the
  latest version, and an Update button or a copyable command. Tests:
  `provider/utils/tests/update-method.test.ts` and `provider/tests/provider-maintenance.test.ts`
  (real fake binary). Scenario `settings-provider-update` updates a fixture codex. Not built: the
  post-pin compatibility ranges from the 2026-09-24 delta.

## Matched or rejected first-pass claims

- **Child ownership is not generally missing.** Current `apps/server/src/provider/adapters/state/codex-child-agents.ts` plus exact native-response/Stop tests at `adapters/tests/codex.test.ts:1473,1516,1555,1579` implement the recent repairs. Do not repeat the historical `docs/chat-t3code-parity.md` baseline as a current finding. The narrow remaining native permission problem is RUNTIME-11.
- **Multiple provider accounts are not generally missing.** Local `provider/provider-adapter-registry.ts:448` constructs configured drivers with isolated environment/credential locations; `provider-service.ts:1008` controls continuation binding. Upstream `provider/Layers/ProviderRegistry.ts:11-15` also keys by instance. Additional drivers/options are distinct gaps.
- **Replay/snapshot fallback is implemented.** Local `orchestration/streams.ts:145-155` checks missing/ahead/too-large/evicted cursors; `:342` replays the boundary for multi-frame events. Tests at `tests/streams.test.ts:115,151,167,218` cover these cases. Upstream `apps/server/src/ws.ts:1978-1984` also subscribes before snapshot/catch-up; do not replace working local transport because upstream uses Effect RPC.
- **Recovery is not an empty stub.** `orchestration/engine.ts:553` commits projection work transactionally, `:633-665` marks ambiguous in-flight execution interrupted without blindly resending it, and `tests/recovery.test.ts:17,41,144` covers paged recovery and queued-start ownership. Upstream resume/adopt code (`provider/Layers/ProviderService.ts:1238-1301`) alone does not prove restart semantics match; automatic continuation after server update remains separately unverified.
- **Discovery/import is reachable and guarded.** Local `session-discovery.ts:265-275` rejects deleted, wrong-instance, reparented or already-continued sessions. Upstream `project/AgentSessionImporter.ts:208,222` similarly checks activity and installs resume identity before visibility. No finding based merely on local `session` vs upstream `thread` nomenclature.
- **General MCP forms were an overbroad prior claim.** Pinned upstream rejects URL/unrecognized forms (`CodexSessionRuntime.ts:330-334,2172-2179`; tests `:519`). RUNTIME-03 targets recognized app-access forms only.
- **Claude one-million context is not wholly missing.** The local native options helper reads it at `adapters/utils/claude-query-options.ts:121-125`. RUNTIME-06 is about advertised descriptors/options and exact selected-value wiring.
- **Framework differences are not defects.** Bun/Elysia/Valibot/async iterators can implement the same contracts as upstream Effect services/streams; no rewrite is required for alignment.

## Second-pass negative-path and wiring results

1. Traced native request dispatch through response serialization, finding RUNTIME-11 after initially counting permission request recognition as support. Positive recognition did not prove a valid native reply.
2. Traced rewind's failure order, finding file restore precedes both unsupported-Claude and missing-binding failure. Added shared-workspace refusal and no-file conversation rewind to RUNTIME-01; limited acceptance to demonstrated upstream preflight semantics, not imagined cross-resource atomicity.
3. Followed subscription queues through the socket send and client queue. Rejected bounded replay-tail size as proof of bounded delivery; RUNTIME-04 includes in-flight retention and overflow recovery.
4. Rechecked upstream elicitation response generation, including its unknown-schema acceptance fallback. Searched local native switch instead of relying on downstream normalized activity names.
5. Checked old parity claims against current source and retained repaired child, steering, interruption and late-completion paths as existing. No blanket regression allegation.
6. Compared quiet background work after parent completion against reaper inputs. Timestamp refresh helps active event streams but does not replace a background liveness guard; periodic timing also differs.
7. Verified manual compaction, usage redemption, maintenance and streaming modes have real upstream consumers. Did not promote generic auth/schema entries into claims of working universal provider login/install.
8. Checked instance/environment boundaries in discovery and continuation; plans keep explicit local ownership instead of copying upstream thread IDs into another environment's session.

## Implementation ordering and remaining verification

First implement RUNTIME-01 and RUNTIME-11 with failing native/Git boundary cases, then RUNTIME-03 and RUNTIME-04. RUNTIME-06 is the option-model prerequisite for provider expansion. Ship each RUNTIME-02 driver independently with complete settings→adapter→history coverage. Compaction, reaping, delivery policy, usage and maintenance are independently reviewable after their stated dependencies. Coordinate all UI work with interaction/lifecycle/platform reports; avoid parallel edits to shared contracts.

No test suite or real provider run was executed in this read-only audit. Existing test citations describe source coverage, not fresh passing results. Runtime memory bounds, live login across accounts, external CLI versions, import of diverse real histories, recovery during update, background-process liveness, permission requests from installed Codex, and provider-specific native error paths remain unverified. Acceptance requires focused adapter/process-boundary checks plus real running-app scenarios and screenshots; performance claims require measured traces. Provider binary install/update and reset-credit consumption must not be exercised as incidental verification.

This report covers server/runtime semantics across the browser/client-core boundary. Native macOS/TUI parity, mobile/remote onboarding, cloud/distribution and general provider setup presentation are covered by the root/platform audit; their existence is not waived by Platform's previous scope. Full runtime equivalence is not established by these two static passes.
