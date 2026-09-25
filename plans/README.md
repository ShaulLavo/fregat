# Implementation plans

Only unfinished implementation plans live in this directory. Completed plans are deleted; git
history is the archive. Draft or outdated strategy documents remain under `docs/` until they are
reviewed, rewritten, or promoted into an executable plan.

Cross-project dependencies and execution order are authoritative in [`PLAN.md`](../PLAN.md). This
index lists executable plans only; it does not define a second roadmap.

The separate [Editor backlog](../../Editor/plans/README.md) holds 55 entries covering all 28 Editor
wishlist topics, 15 of them still executable plans (2026-09-25), with their package/host ownership and
dependencies. Plan 071 remains the existing syntax-retry proposal here.

Before executing a plan, reconcile its drift check and line references against current source.
Verification uses per-workspace baseline deltas; never gate completion on an absolute test count or
a bare root `bun run verify`.

## Executable plan inventory

| Plan                                                                                    | State                                                                     |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [173 — two devices opening one workspace](173-two-devices-one-workspace.md)             | **RESEARCH — BEFORE PLAN 143'S PHONE SHELL**                              |
| [172 — one shared undo/redo stack](172-shared-undo-stack.md)                            | **RESEARCH — LIFE-13 IS THE FIRST CONSUMER**                              |
| [171 — the chat composer runs on our own editor](171-composer-on-our-editor.md)         | **RESEARCH — AFTER PLAN 111**                                             |
| [170 — language census for grammar and theme prefetch](170-language-census.md)          | **PROPOSED — SPLIT FROM 110 Q7**                                          |
| [167 — settings defaults, setting details, and copy](167-settings-and-copy.md)          | **PROPOSED — READY; D1–D4 DECIDED**                                       |
| [166 — keyboard shortcuts, redone](166-shortcuts-editor.md)                             | **PROPOSED — RESEARCH FIRST; D1–D6 DECIDED**                              |
| [164 — what feels right in Neon](164-what-feels-right-in-neon.md)                       | **FIRST PASS SHIPPED; METADATA SWEEP LEFT**                               |
| [159 — file and folder picker](159-file-picker.md)                                      | **PROPOSED — READY; DECISIONS ACCEPTED**                                  |
| [158 — app polish from Neon](158-app-polish.md)                                         | **PROPOSED — READY; DECISIONS ACCEPTED**                                  |
| [157 — base components](157-base-components.md)                                         | **PROPOSED — READY; QUEUED NEXT**                                         |
| [156 — documents in the editor](156-documents-in-the-editor.md)                         | **PLACEHOLDER — FAR FUTURE; RESEARCH FIRST**                              |
| [155 — site demo becomes an animated replica](155-site-demo-replica.md)                 | **PLACEHOLDER — RESEARCH NOT STARTED**                                    |
| [154 — physical mode](154-physical-mode.md)                                             | **PROPOSED — D6 (SETTINGS SHAPE) FIRST**                                  |
| [153 — TypeScript can run in the browser worker](153-typescript-worker-backend.md)      | **PROPOSED — AFTER EDITOR E054; D1–D3 NEED THE OWNER**                    |
| [152 — dev primary ships its working tree](152-remote-dev-builds.md)                    | **PROPOSED — NICE TO HAVE; AFTER 151**                                    |
| [151 — remote machines run the primary's release](151-remote-server-releases.md)        | **PROPOSED — DEPENDS ON 150 PHASE 1; D2/D4 TO CONFIRM**                   |
| [150 — remote machines run a server that matches](150-remote-server-version.md)         | **PHASE 1 PARTLY DONE (`129fdea6`); PHASE 2 → PLANS 151/152**             |
| [149 — terminals outlive the server](149-terminal-host.md)                              | **PROPOSED — D2 (DESKTOP-QUIT LIFETIME) NEEDS THE OWNER**                 |
| [148 — server deploys restart when idle](148-restart-when-idle.md)                      | **PROPOSED — D3 REPLACED: RESTART ON CLICK (COMPLETION WAVE)**            |
| [147 — log hygiene and a noise gate](147-log-hygiene-and-noise-gate.md)                 | **PROPOSED — PHASE 1 READY; PHASE 3 CARRIES PLAN 125'S REST**             |
| [145 — harness controls](145-harness-controls.md)                                       | **IMPLEMENTED (L3); OWNER REVIEW FIXES COMPLETE, VALIDATION IN PROGRESS** |
| [144 — unattended agent work](144-unattended-agent-work.md)                             | **RESEARCH — Q1–Q3 DECIDED; AFTER PRS #32 AND #35**                       |
| [143 — phone layout](143-phone-layout.md)                                               | **DISCUSSION — OWNER DIRECTION FIRST**                                    |
| [142 — web push](142-web-push.md)                                                       | **PROPOSED — SPIKE FIRST**                                                |
| [141 — usage and rate limits](141-usage-and-rate-limits.md)                             | **PHASES 1–3 IMPLEMENTED; PHASE 4 OPEN; PHASE 5 NEEDS THE OWNER**         |
| [140 — the editor as the agent's advantage](140-editor-agent-advantage.md)              | **RESEARCH — RESEARCH PHASE FIRST**                                       |
| [139 — acting on agent diffs](139-acting-on-agent-diffs.md)                             | **RESEARCH — RESEARCH PHASE FIRST**                                       |
| [135 — TanStack async ownership and route preparation](135-tanstack-async-ownership.md) | **PROPOSED — RESEARCH COMPLETE; IMPLEMENTATION NOT STARTED**              |
| [132 — process and dev ownership](132-process-and-dev-ownership.md)                     | **PHASE 1 IMPLEMENTED (`4749fd05`); PHASES 2–4 OPEN**                     |
| [130 — ask the editor](130-ask-the-editor.md)                                           | **PHASES 1, 2, 4 AND 5 (ITEMS 5–7, 9) DONE; 3, ITEMS 8 AND 10 OPEN**      |
| [129 — dependency shape](129-dependency-shape.md)                                       | **PHASES 1–2 DEPLOYED; PHASE 3 Q2–Q4 OPEN**                               |
| [128 — React 19 patterns](128-react-19-patterns.md)                                     | **NOT STARTED — PARTLY OBSOLETE; REWRITE SMALL FIRST**                    |
| [126 — T3 Code behavioral alignment](126-t3code-alignment.md)                           | **IN PROGRESS — 26 OF 57 GROUPS DONE (10 VERIFIED), 9 PARTIAL, 22 OPEN**  |
| [071 — syntax highlight retry](071-syntax-highlight-retry.md)                           | **PROPOSED — ROOT GO/NO-GO SCHEDULING**                                   |
| [080 — Platform and VS Code keybinding modes](080-platform-keybinding-modes.md)         | **PROPOSED — INTERACTION RULES CONFIRMED**                                |
| [087 — stateless MCP support](087-stateless-mcp.md)                                     | **M0 APPROVED 2026-09-25; M1+ AWAITS THE OWNER**                          |
| [088 — native code intelligence](088-native-code-intelligence.md)                       | **PROPOSED — DEPENDS ON 087**                                             |
| [091 — error and timing helpers](091-error-and-timing-helpers.md)                       | **PARTIAL — IDENTICAL HALVES MERGED (`becdf722`); REST OPEN**             |
| [092 — path and URI helpers](092-path-and-uri-helpers.md)                               | **PARTIAL — IDENTICAL HALVES MERGED (`becdf722`); REST OPEN**             |
| [093 — web React and store ceremony](093-web-react-and-store-ceremony.md)               | **PARTIAL — 3 OF 14 DONE; GUARD SWEEP AFTER 091 ITEM 1.4**                |
| [099 — document contribution runtime](099-document-contributions.md)                    | **PROPOSED — UNITS 0–1 APPROVED 2026-09-25; 2–7 GATED**                   |
| [102 — scroll and keyboard affordance](102-scroll-and-keyboard-affordance.md)           | **PROPOSED — DECISIONS D2 AND D7 NEED CONFIRMATION**                      |
| [124 — the theme studio](124-theme-studio.md)                                           | **PROPOSED — REPLACES 117'S SURFACE; DATA STAYS**                         |
| [122 - composable full-power plugins](122-composable-plugins.md)                        | **PROPOSED - RESEARCH AND PERFORMANCE GATES FIRST**                       |
| [114 — Polaron, a desktop shell we own](114-polaron-shell.md)                           | **PARKED — NEEDS A GO/NO-GO**                                             |
| [108 — two markdown modes](108-markdown-modes.md)                                       | **PROPOSED — PHASE 1 READY; PHASE 2 NEEDS 111**                           |
| [109 — boot boundaries and gate](109-boot-boundaries.md)                                | **PHASES 2–3 IMPLEMENTED 2026-09-21; GATE NOT STARTED**                   |
| [110 — workspace indexing](110-workspace-indexing.md)                                   | **RESEARCH — NO IMPLEMENTATION SCOPE YET**                                |
| [111 — editor decorations](111-editor-decorations.md)                                   | **RESEARCH — AUTHORIZED 2026-09-25; BEFORE THE NEXT WAVE**                |
| [112 — the large-file ceiling](112-large-file-ceiling.md)                               | **RESEARCH — ONE LANE WITH EDITOR E015, 112 FIRST**                       |
| [094 — client-core web and TUI parity](094-client-core-web-tui-parity.md)               | **PARTIAL — 2 OF 23 DONE; 096 COMPLETE**                                  |
| [095 — server plumbing](095-server-plumbing.md)                                         | **PARTIAL — IDENTICAL HALVES MERGED; REGISTRY STREAM BUG OPEN**           |
| [075 — say which renderer the terminal is using](075-terminal-renderer-fallbacks.md)    | **REWRITTEN 2026-09-25 — LOG AND SHOW THE RENDERER TIER**                 |
| [076 — watch-reload child reaping](076-watch-reload-child-reaping.md)                   | **PROPOSED — ROOT GO/NO-GO SCHEDULING**                                   |

## Dependency notes

- Plan 127 is done and deleted; Plan 128's terminal premise is obsolete since `2acc3b73` deleted
  the server's detach TTL. The history below is kept for 128's rewrite.
- Plans 127 and 128 and the 2026-09-20 revision of Plan 109 come from one review of React behaviour
  at Platform `b915d3e0`. Plan 127 is separable and small because each of its five repairs is one
  call site carrying its own proof: `compiler: true` in `apps/web/vite.config.ts` discards every
  compiler diagnostic, four files lose all memoization to `ref={focusTarget.ref}`, two ternaries
  unmount every terminal and let the server kill the shells ten minutes later, seven git write hooks
  invalidate the whole `['git']` subtree when the response already carried the new status, and the
  command palette takes one command-bus capture per rendered row. Its only new gate is
  `scripts/lint/react-compiler-census.mjs`, which Phase 2 cannot be proven without. The first of its
  six terminal sites is applied in the working tree and unverified in a browser; the two panel-collapse
  sites turned out to be a layout-engine change, and the chat-mode site was reverted because mounting
  the terminal unconditionally spawns a shell per session. Plan 128 is
  rules rather than a migration: 46 classifications were re-checked adversarially and 34 were
  overturned, most of them because `<Activity mode="hidden">` applies `display: none !important` and
  nearly every pane here measures itself — Base UI's collapsible reads `scrollHeight`,
  `use-listbox.ts` reads `offsetHeight`, `VirtualList` calls `measureElement` per row. Safety under
  `display: none` is a property of the children, so no `packages/ui` primitive can own the boundary
  and the deliverable is three `AGENTS.md` sections, each naming an exemplar already in the
  repository. The bundle work stayed in 109 because the first per-owner attribution answered the
  question that plan was waiting on rather than opening a new one: every non-entry chunk is vendor
  or data, no first-party byte sits outside the entry chunk, and the two surviving boundaries are
  worth 6.25% of it against 59.5% in `node_modules` and the linked Editor packages. A new plan would
  have restated 109's Phases 2–4 against a different number. Nothing in this group has been measured
  in a browser: the dev server is down, and every `agent:browser` line in all three plans is a
  prescription.

- Plan 126 pins T3 Code and records 57 alignment groups (48, plus nine from the 2026-09-24 delta) after two source-audit passes and
  independent cross-review. Its first delivery units cover archive semantics, safe rewind,
  native approval replies, bounded delivery and PR lookup failures. The reports, acceptance
  cases, contract census and open finding ledger live beside the master plan. Reconcile shared
  client-core work with 094, keyboard behavior with 080, native capabilities with 087/088,
  verification tooling with 119 and background telemetry with 125. This is an execution plan.
  As of 2026-09-25, 26 groups are implemented and deployed, 9 are partial and 22 are open; the
  master plan holds the status line. A row closes when its
  `agent:browser` scenario proves the behaviour. Root `PLAN.md` remains the roadmap owner.

- Plan 125 is done and deleted. The [observability reference](../docs/observability-overhead.md)
  records admission and delivery; its open measurements are Plan 147 Phase 3 steps 5–8.

- Plan 122 records the single `createPlugin` entrypoint, composable third-party extension points,
  full-power isomorphic execution, and selective notification requirements. CodeMirror/Monaco
  comparison and calibrated controls precede API selection. It coordinates Singapore E025-E028,
  reuses Plan 099's document-publication ownership, and shares decoration research with Plan 111.
  Its phases do not reorder existing lanes; production scheduling remains in root `PLAN.md`.
  This planning change does not modify the Singapore repository or implement the plugin runtime.

- Plans 115, 116 and 117 replace the retired Plan 104. All three are done; 115 and 116 are deleted,
  and [theme bundles](../docs/theme-bundles.md) is 117's reference. The pieces come first: Plan 115 moves
  palettes out of `globals.css` into OKLCH data with a resolver, a server library and an editor
  that repaints the app while dragging; Plan 116 gives wallpaper its own content-addressed library,
  per-mode picker and explicit rendering on Linux, seeded from the Omarchy themes on the host.
  Plan 117 now binds light and dark variants under one name, each with its own palette, syntax
  colors, wallpaper and material, with per-variant customization and a portable archive. Switching
  bundles or modes applies the destination variant’s wallpaper. 115 and 116 touch different files and can
  run concurrently. The [research reference](../docs/theme-standardization-reference.md) records
  the pinned Omarchy, T3 Code, and CodexThemes-App findings. Plan 085 shares the boot mirror with
  115; whichever lands second reuses the first's boot ownership.

- Plan 096 is complete and its executable plan is deleted. The
  [web layering reference](../docs/web-layering.md) records ownership decisions, review fixes,
  and verification. The repository-wide Knip check is clean and now runs in CI.

- Plan 099 owns canonical Editor buffer publication and shared document synchronization through
  contributions. Baseline/publication groundwork can proceed independently. Its public cutover follows
  the completed identity and source-ownership contracts from 098 then 097. It uses strings and
  incremental edits in the existing separate workers. Units 0–1 are approved (owner, 2026-09-25).
  The SAB text transport is deleted ahead of it as Editor E057; Editor E009 is folded into its unit
  6, and E010, E012 and E013 shared storage were closed as no-go. E014 parallel search must reuse the runtime if implemented.

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
  API files before 094's co-pass over them.

- [Workspace navigation](../docs/workspace-navigation.md) uses TanStack Router as its sole browser
  history owner, preserving local workspace IDs, URL tabs, unsaved documents, and environment
  ownership. The full Chromium, Firefox, and macOS WebKit replay passes, including a second live
  machine and reload during continuous input. Plan 085's first-paint work remains separate. The
  [evaluation](../docs/router-evaluation.md) records the alternatives. No sharing backend is scheduled.

- Plan 085 is complete and its executable plan is deleted. The
  [reload delivery record](../docs/instant-reload-implementation.md) covers all visible panes,
  native Editor/Ghostty contracts, bounded saved presentation, authority checks, and the passing
  desktop/narrow verification matrices. Paired native source changes remain unpublished.

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

- Plans 106 through 109 come from the first-load weight review at Platform base `00513340`. That
  build sent 2421 KB gzip of JavaScript before the first frame, 2311 KB of it in one chunk, because
  the application declares almost no loading boundaries — not because of bundler configuration.
  Plans 106 and 107 are done and deleted.
  Plan 106 built the measurement instrument and landed the two removals that depend on nothing else.
  Plan 107 replaces streamdown with `@workspace/markdown`, which is what removes the duplicate
  `shiki@3.23.0` installation that `@streamdown/code` drags in. Plan 108 gives
  markdown a split view and finishes the live-preview experiment rather than deleting it. Plan 109
  still runs last; its 2026-09-20 revision measures 2217 KB gz of first-load JavaScript, withdraws
  the clause that made the gate wait for a final number, and pins after its own Phase 3 with a
  re-pin after 108. Rolldown is already in use; there is no bundler migration in any of them.
  Plan 129 owns the two items 109 measured and handed off: the Editor's three inline workers, 25.5%
  of first-load JavaScript, and the `@phosphor-icons/react` weights no call site draws.

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
