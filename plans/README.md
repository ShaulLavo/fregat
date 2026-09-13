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

| Plan                                                                            | State                                                |
| ------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [071 — syntax highlight retry](071-syntax-highlight-retry.md)                   | **PROPOSED — ROOT GO/NO-GO SCHEDULING**              |
| [080 — Platform and VS Code keybinding modes](080-platform-keybinding-modes.md) | **PROPOSED — INTERACTION RULES CONFIRMED**           |
| [085 — instant workspace reload](085-instant-workspace-reload.md)               | **PROPOSED — IMPLEMENTATION NOT STARTED**            |
| [087 — stateless MCP support](087-stateless-mcp.md)                             | **PROPOSED — IMPLEMENTATION NOT STARTED**            |
| [088 — native code intelligence](088-native-code-intelligence.md)               | **PROPOSED — DEPENDS ON 087**                        |
| [091 — error and timing helpers](091-error-and-timing-helpers.md)               | **PROPOSED — DEFECT FIXES IMPLEMENTED**              |
| [092 — path and URI helpers](092-path-and-uri-helpers.md)                       | **PROPOSED — DEFECT FIXES IMPLEMENTED**              |
| [093 — web React and store ceremony](093-web-react-and-store-ceremony.md)       | **PROPOSED — DEPENDS ON 091**                        |
| [099 — document contribution runtime](099-document-contributions.md)            | **PROPOSED — BASELINE AND PUBLICATION FIRST**        |
| [101 — truncation and value recovery](101-truncation-recovery.md)               | **PROPOSED — DECISIONS D5 AND D7 NEED CONFIRMATION** |
| [102 — scroll and keyboard affordance](102-scroll-and-keyboard-affordance.md)   | **PROPOSED — DECISIONS D2 AND D7 NEED CONFIRMATION** |
| [103 — loading, empty and error states](103-loading-empty-error-states.md)      | **PROPOSED — DECISIONS D4 AND D6 NEED CONFIRMATION** |
| [104 — theme standardization](104-theme-standardization.md)                     | **PROPOSED — IMPLEMENTATION NOT STARTED**            |
| [105 — one server and mesh deployment](105-one-server-mesh-deployment.md)       | **PROPOSED — PHASE 1 READY TO IMPLEMENT**            |
| [106 — first-load weight](106-boot-weight.md)                                   | **IMPLEMENTED 2026-09-13**                           |
| [107 — a markdown package we own](107-workspace-markdown.md)                    | **IMPLEMENTED 2026-09-13**                           |
| [108 — two markdown modes](108-markdown-modes.md)                               | **PROPOSED — PHASE 1 READY; PHASE 2 NEEDS 111**      |
| [109 — boot boundaries and gate](109-boot-boundaries.md)                        | **PROPOSED — DEPENDS ON 106; SCHEDULED AFTER 108**   |
| [110 — workspace indexing](110-workspace-indexing.md)                           | **RESEARCH — NO IMPLEMENTATION SCOPE YET**           |
| [111 — editor decorations](111-editor-decorations.md)                           | **RESEARCH — NO IMPLEMENTATION SCOPE YET**           |
| [112 — the large-file ceiling](112-large-file-ceiling.md)                       | **RESEARCH — NO IMPLEMENTATION SCOPE YET**           |
| [113 — one optimistic primitive](113-optimistic-intents.md)                     | **PROPOSED — CORE AND RAIL MIGRATION IMPLEMENTED**   |
| [094 — client-core web and TUI parity](094-client-core-web-tui-parity.md)       | **PROPOSED — DEPENDS ON 091; 096 COMPLETE**          |
| [095 — server plumbing](095-server-plumbing.md)                                 | **PROPOSED — IMPLEMENTATION NOT STARTED**            |
| [073 — Electrobun 2.x migration](073-electrobun-v2-migration.md)                | **PROPOSED — ROOT GO/NO-GO SCHEDULING**              |
| [075 — terminal renderer fallbacks](075-terminal-renderer-fallbacks.md)         | **PROPOSED — BLOCKED ON TIER DECISION**              |
| [076 — watch-reload child reaping](076-watch-reload-child-reaping.md)           | **PROPOSED — ROOT GO/NO-GO SCHEDULING**              |

## Dependency notes

- Plan 104 replaces independent app palette and code-theme selections with complete themes,
  saved customization, and wallpaper collections. It builds on the implemented
  [web design language](../docs/web-design-language.md), coordinates shared style edits with
  Plans 101–103, and shares boot ownership with
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

- The required **098 → 097** order is complete. The [document model](../docs/document-and-tab-domain.md)
  and [async operation ownership](../docs/async-operation-ownership.md) references describe the
  implemented contracts. Plan 099 reuses the retained workspace-edit service and its issued sources.

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

- [Workspace navigation](../docs/workspace-navigation.md) uses TanStack Router as its sole browser
  history owner, preserving local workspace IDs, URL tabs, unsaved documents, and environment
  ownership. The full Chromium, Firefox, and macOS WebKit replay passes, including a second live
  machine and reload during continuous input. Plan 085's first-paint work remains separate. The
  [evaluation](../docs/router-evaluation.md) records the alternatives. No sharing backend is scheduled.

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
  and the two-server A → B → A browser workflow pass.
  [Federation](../docs/federated-environments.md) replaces the dev-only loopback switch and scopes
  browser persistence by confirmed environment identity.
- Plan 068 is implemented and its executable plan is deleted. The
  [session-domain reference](../docs/session-domain.md) links the contracts, registration,
  recovery, discovery, and environment-scoped navigation tests. It supplies explicit
  Project → Worktree → Session ownership and the server's three attention states.
- [Federated environments](../docs/federated-environments.md) supplies Machines settings, backend
  SSH launch and forwarding, concurrent chat connections, scoped persistence, repository grouping,
  machine filtering, remote project selection, and retained workbench switching. Live Linux/macOS
  checks cover browser reconnect and managed-process ownership. Direct `https://` origins are
  accepted; direct remote deployment checks and pairing remain separate, on demand.
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

- Plans 106 through 109 come from the first-load weight review at Platform base `00513340`. The
  production build sends 2421 KB gzip of JavaScript before the first frame, 2311 KB of it in one
  chunk, because the application declares almost no loading boundaries — not because of bundler
  configuration. Plan 106 builds the measurement instrument and lands the two removals that depend
  on nothing else. Plan 107 replaces streamdown with `@workspace/markdown`, which is what removes
  the duplicate `shiki@3.23.0` installation that `@streamdown/code` drags in. Plan 108 gives
  markdown a split view and finishes the live-preview experiment rather than deleting it. Plan 109
  runs last, because 107 and 108 both move the number a gate would otherwise pin twice. Rolldown is
  already in use; there is no bundler migration in any of them.

- Plans 110 and 111 are research, not executable work. They sit in this inventory rather than under
  `docs/` so they stay visible, and each ends in a decision record plus the executable plans it
  becomes. Plan 110 asks what belongs in a workspace index beyond today's file index in
  `apps/server/src/fs/workspace-index.ts`; its consumers are Shiki grammar prefetch, Plan 088's
  semantic retrieval, Plan 108's document graph, and search. Plan 111 compares `@singapore-editor`'s
  inline-replacement layer against CodeMirror 6 decorations and Lexical's decorator nodes; it gates
  Plan 108 Phase 2, any later Obsidian mode, and the question of whether the chat composer still
  needs Lexical.

## Cleanup policy

- Delete a plan once its implementation and completion checks are verified.
- Keep incomplete plans even when their paths or assumptions are stale; update them before execution.
- Do not preserve a completed-plan ledger here. Use git history and the implementation's tests/docs.
- When deleting a completed plan, replace live backlinks with current code, tests, or stable reference docs.
