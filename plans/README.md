# Implementation plans

Only unfinished implementation plans live in this directory. Completed plans are deleted; git
history is the archive. Draft or outdated strategy documents remain under `docs/` until they are
reviewed, rewritten, or promoted into an executable plan.

Cross-project dependencies and execution order are authoritative in [`PLAN.md`](../PLAN.md). This
index lists executable plans only; it does not define a second roadmap.

The separate [Editor backlog](../../Editor/plans/README.md) contains 30 proposed plans covering
all 22 Editor wishlist topics, including their package/host ownership and dependencies. They are
an unscheduled proposal inventory; Plan 071 remains the existing syntax-retry proposal here.

Before executing a plan, reconcile its drift check and line references against current source.
Verification uses per-workspace baseline deltas; never gate completion on an absolute test count or
a bare root `bun run verify`.

## Executable plan inventory

| Plan                                                                            | State                                                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [078 — federated environments](078-federated-environments.md)                   | **IMPLEMENTED — AUTOMATED CHECKS PASS; LIVE GATES OPEN**      |
| [071 — syntax highlight retry](071-syntax-highlight-retry.md)                   | **PROPOSED — ROOT GO/NO-GO SCHEDULING**                       |
| [080 — Platform and VS Code keybinding modes](080-platform-keybinding-modes.md) | **PROPOSED — INTERACTION RULES CONFIRMED**                    |
| [085 — instant workspace reload](085-instant-workspace-reload.md)               | **PROPOSED — IMPLEMENTATION NOT STARTED**                     |
| [086 — full TanStack Router migration](086-tanstack-router-migration.md)        | **IMPLEMENTED — CHROMIUM/FIREFOX PASS; LIVE LIMITS RECORDED** |
| [087 — stateless MCP support](087-stateless-mcp.md)                             | **PROPOSED — IMPLEMENTATION NOT STARTED**                     |
| [088 — native code intelligence](088-native-code-intelligence.md)               | **PROPOSED — DEPENDS ON 087**                                 |
| [091 — error and timing helpers](091-error-and-timing-helpers.md)               | **PROPOSED — DEFECT FIXES IMPLEMENTED**                       |
| [092 — path and URI helpers](092-path-and-uri-helpers.md)                       | **PROPOSED — DEFECT FIXES IMPLEMENTED**                       |
| [093 — web React and store ceremony](093-web-react-and-store-ceremony.md)       | **PROPOSED — DEPENDS ON 091**                                 |
| [097 — async operation ownership](097-async-operation-ownership.md)             | **PROPOSED — 098 COMPLETE; READY TO IMPLEMENT**               |
| [099 — document contribution runtime](099-document-contributions.md)            | **PROPOSED — BASELINE AND PUBLICATION FIRST**                 |
| [100 — web design language](100-web-design-language.md)                         | **IMPLEMENTED — CENSUS GATE GREEN; AUDIT FINDINGS APPLIED**   |
| [101 — truncation and value recovery](101-truncation-recovery.md)               | **PROPOSED — DECISIONS D5 AND D7 NEED CONFIRMATION**          |
| [102 — scroll and keyboard affordance](102-scroll-and-keyboard-affordance.md)   | **PROPOSED — DECISIONS D2 AND D7 NEED CONFIRMATION**          |
| [103 — loading, empty and error states](103-loading-empty-error-states.md)      | **PROPOSED — DECISIONS D4 AND D6 NEED CONFIRMATION**          |
| [104 — theme standardization](104-theme-standardization.md)                     | **PROPOSED — IMPLEMENTATION NOT STARTED**                     |
| [094 — client-core web and TUI parity](094-client-core-web-tui-parity.md)       | **PROPOSED — DEPENDS ON 091; 096 COMPLETE**                   |
| [095 — server plumbing](095-server-plumbing.md)                                 | **PROPOSED — IMPLEMENTATION NOT STARTED**                     |
| [073 — Electrobun 2.x migration](073-electrobun-v2-migration.md)                | **PROPOSED — ROOT GO/NO-GO SCHEDULING**                       |
| [075 — terminal renderer fallbacks](075-terminal-renderer-fallbacks.md)         | **PROPOSED — BLOCKED ON TIER DECISION**                       |
| [076 — watch-reload child reaping](076-watch-reload-child-reaping.md)           | **PROPOSED — ROOT GO/NO-GO SCHEDULING**                       |

## Dependency notes

- Plan 104 replaces independent app palette and code-theme selections with complete themes,
  saved customization, and wallpaper collections. It builds on Plan 100's implemented design
  tokens, coordinates shared style edits with Plans 101–103, and shares boot ownership with
  Plan 085. The [research reference](../docs/theme-standardization-reference.md) records pinned
  Omarchy, T3 Code, and CodexThemes-App findings. TUI consumers migrate with shared settings;
  native Swift theming and OS theme synchronization are outside this plan.

- Plan 096 is complete and its executable plan is deleted. The
  [web layering reference](../docs/web-layering.md) records ownership decisions, review fixes,
  and verification. The repository-wide Knip check is clean and now runs in CI.

- Plan 099 owns canonical Editor buffer publication and shared document synchronization through
  contributions. Baseline/publication groundwork can proceed independently. Its public cutover follows
  the completed identity and source-ownership contracts from 098 then 097. It uses strings and
  incremental edits in the existing separate workers, removing SAB text transport with the syntax
  migration. Editor E009 supplies measurement evidence; E013 shared storage is deferred outside
  this refactor. E014 parallel search must reuse the runtime if implemented.

- **Required order: 098 → 097**, as recorded in [`PLAN.md`](../PLAN.md#document-and-async-operation-ownership).
  Complete and verify all of Plan 098 before starting any implementation in Plan 097. Design
  agreement or partial migration does not release Plan 097. Record completion evidence and the
  implemented document API locations in Plan 097, then refresh its source anchors and drift baseline.
  Plan 098 owns the document and tab model, with behavioral characterization before production
  changes. It supersedes Plan 096's document-scheme factory proposal and takes over its
  coalesced-log move and shared-layer import guard.

- Plan 087 delivers managed external MCP connections and the native Platform tool endpoint using
  protocol revision `2026-07-28` and SDK v2, with explicit stateless operation, scoped authentication,
  and real provider integration. Plan 088 depends on its completion and implements the full native
  semantic retrieval, transactional editing, refactoring, project memory, and debugging program.
  The [Serena comparison](../docs/serena-implementation-comparison.md) records implementation lessons
  and the required improvements to existing document, LSP, and transaction services.

- Plans 091 through 096 come from the duplication census at Platform base `75caae88`.
  The prerequisite defect fixes are implemented and documented in the
  [regression reference](../docs/duplicate-defect-regressions.md). Each consolidation must preserve
  those tests. Plans 091, 092, 093, and 094 consolidate error and timing helpers, path and URI helpers,
  web React and store ceremony, and runtime-neutral web/TUI logic. Plan 095 consolidates server
  plumbing, and Plan 096 settles web layering. Plan 096 settles the shared Git contract and web Git
  API files before Plan 094's co-pass over them.

- Plan 086 makes TanStack Router the sole web navigation owner, migrates all navigation callers,
  and deletes the custom URL controller. It keeps local workspace IDs and URL tabs, fixes
  history/persistence, and supplies reusable view data for sharing. Implementation, focused automated checks, and
  Chromium/Firefox browser gates pass. The initial and follow-up review findings are fixed, with
  focused regression evidence recorded in the plan. WebKit is missing host libraries; a second configured live
  environment remains unverified. The mandatory two-server in-process ownership gate passes.
  Plan 085's first-paint work remains separate. The [evaluation](086-router-evaluation.md) records
  the alternatives. No sharing backend is scheduled.

- Plan 085 restores the visible workspace before live responses, starting with bootstrap, file tree,
  and settings. It reuses feature renderers and keeps native paint separate from current-state
  authority. Diff/search native paint and terminal replay may require package contracts; those
  dependencies remain open until verified. Execution order is recorded in root `PLAN.md`.

- Plans 081 and 082 are complete and their executable plans are deleted. The
  [workbench record](../docs/tui-workbench.md) and [Agent view record](../docs/tui-agent.md) preserve
  implementation and native verification. The [worktree record](../docs/tui-worktrees.md)
  covers Plan 083. Distribution (084) is next in the [TUI strategy](../docs/tui-plan.md).
  Plan 080 belongs to platform keybinding modes.

- Plan 080 extends the existing preset selector to workspace commands and adds whole-sidebar Cmd+B.
  Editor tabs and chats share navigation keys; panel shortcuts use a separate combination. Held
  modifiers reveal the matching targets. Interaction rules are confirmed and exact keys remain a
  proposal. Implementation uses the [shared keymap runtime](../docs/keymap/delivery.md) and preserves
  its target registry, enablement evaluator, terminal handoff, and parity records.

- The sole command/focus runtime is landed in `keymap/table.ts`, `keymap/state/command-bus.ts`,
  `keymap/providers/command-provider.tsx`, and `lib/focus/`. Settings commands use the semantic
  submission returned by `use-settings-actions.ts` and await `settled`; do not restore persistent
  preview dispatch, duplicate settings error reporting, or a second mutation path.
- Plan 077 is complete and its executable plan is deleted. Canonical runtime origins own HTTP
  clients, QueryClients, and retained editor runtimes; the identity/protocol gate checks the server
  before editor consumers mount. Switching preserves unsaved buffers and routes pending work to
  its original owner. Query consumers remount under one outer command bus that captures the active
  runtime. Chat transports close explicitly and WebSocket auth refusal uses `1008`. Focused tests
  and the two-server A → B → A browser workflow pass. Plan 078 removes the dev-only loopback
  switch and scopes browser persistence by confirmed environment identity.
- Plan 068 is implemented and its executable plan is deleted. The
  [session-domain reference](../docs/session-domain.md) links the contracts, registration,
  recovery, discovery, and environment-scoped navigation tests. It supplies explicit
  Project → Worktree → Session ownership and the server's three attention states.
- Plan 078 is implemented with automated checks passing and live localhost SSH
  and browser gates open. It supplies the `environments.machines` setting and page, the
  desktop SSH launcher (probe, reuse-or-launch, loopback forward, no install, no pairing), one chat
  connection per machine, scoped persistence, the flat cross-machine rail with repository grouping,
  chips and a machine filter, add-project-on-machine, and the workbench switch. Direct `https://`
  origins are accepted but the mesh proxy check and pairing are scheduled separately, on demand.
- Plan 071 is an independent Editor-only resilience proposal. Its prerequisite is now stable:
  Platform owns Shiki registration resolution, Editor's Oniguruma worker is self-contained, and
  built-dist highlighting is covered by a real-browser and shared-log proof. Root `PLAN.md` has not
  scheduled the retry work yet.
- Plans 066 and 067 were dropped and deleted. The
  [decision](../PLAN.md#ghostty-appearance-integration-dropped) records the package's no-disk-read boundary.
- The paired paint and prepared-open contracts are landed. Editor owns `EditorVisibleSnapshot`,
  `EditorPreparedDocument`, one-shot exact-revision transfer, and unique worker runtime sessions.
  Platform owns `FileOpenIntentService`, claim-or-ensure activation before selection publication,
  the one-record visual-only snapshot cache, and the exact `editor-open-benchmark.mjs` gate. Cached
  rows are never document truth, and the typed bus and local UI share one activation transaction.

## Cleanup policy

- Delete a plan once its implementation and completion checks are verified.
- Keep incomplete plans even when their paths or assumptions are stale; update them before execution.
- Do not preserve a completed-plan ledger here. Use git history and the implementation's tests/docs.
- When deleting a completed plan, replace live backlinks with current code, tests, or stable reference docs.
