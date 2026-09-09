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

| Plan                                                                                    | State                                                    |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [066 — package Ghostty config resolver](066-package-ghostty-config-resolver.md)         | **PROPOSED — ROOT GO/NO-GO SCHEDULING**                  |
| [067 — integrate Ghostty config appearance](067-integrate-ghostty-config-appearance.md) | **BLOCKED ON 066 REVIEWED ARTIFACT**                     |
| [078 — federated environments](078-federated-environments.md)                           | **IMPLEMENTED — AUTOMATED CHECKS PASS; LIVE GATES OPEN** |
| [071 — syntax highlight retry](071-syntax-highlight-retry.md)                           | **PROPOSED — ROOT GO/NO-GO SCHEDULING**                  |
| [056 — multi-step chord keymap](056-multi-step-chord-keymap.md)                         | **IMPLEMENTED — BROWSER VERIFIED**                       |
| [057 — standalone Editor chords and shared keymap](057-editor-native-vscode-keymap.md)  | **COMPLETE — DELIVERY RECORD RETAINED**                  |
| [080 — Platform and VS Code keybinding modes](080-platform-keybinding-modes.md)         | **PROPOSED — INTERACTION RULES CONFIRMED**               |
| [085 — instant workspace reload](085-instant-workspace-reload.md)                       | **PROPOSED — IMPLEMENTATION NOT STARTED**                |
| [073 — Electrobun 2.x migration](073-electrobun-v2-migration.md)                        | **PROPOSED — ROOT GO/NO-GO SCHEDULING**                  |
| [075 — terminal renderer fallbacks](075-terminal-renderer-fallbacks.md)                 | **PROPOSED — BLOCKED ON TIER DECISION**                  |
| [076 — watch-reload child reaping](076-watch-reload-child-reaping.md)                   | **PROPOSED — ROOT GO/NO-GO SCHEDULING**                  |

## Dependency notes

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
  proposal. Implementation follows the completed shared runtime and preserves Plan 057's parity records.

- The sole command/focus runtime is landed in `keymap/table.ts`, `keymap/state/command-bus.ts`,
  `keymap/providers/command-provider.tsx`, and `lib/focus/`. Settings commands use the semantic
  submission returned by `use-settings-actions.ts` and await `settled`; do not restore persistent
  preview dispatch, duplicate settings error reporting, or a second mutation path.
- Plan 056 extends the typed bus and focus service with two-stroke shortcuts. `CommandProvider`
  owns one keymap session; the terminal forwards keys to that session before Ghostty encodes them.
  Review fixes, focused tests, trusted browser integration, and the full repository typecheck
  pass in an isolated checkout that excludes concurrent environment work.
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
- Plans 056 and 057 are implemented and browser verified. Plan 057 delivered standalone Editor
  chord execution and Platform's adoption of the same public runtime. Preserve its target registry,
  enablement evaluator, terminal handoff, and parity records when extending presets in Plan 080.
- The config-resolver feasibility proof is complete with four native `PASS` rows and accepted
  package ceilings. Its stable records are
  `ghostty-webgpu/docs/config-resolver-feasibility.md` and
  `ghostty-webgpu/docs/config-resolver-feasibility.json`. Plan 066 is eligible only for a separate
  root go/no-go scheduling decision; the proof does not authorize packaging or publication. Plan
  067 remains blocked on Plan 066's reviewed artifact. If a future Ghostty fork is considered,
  prefer upstreaming read-only Config path and Config-only initializer/build boundaries first.
- Plan 067 must wait for the user-owned edits originating from Plan 063 in
  `packages/contracts/src/index.ts`, `apps/server/src/tests/app.test.ts`, and
  `apps/web/test/server.ts` to land or be explicitly reconciled. The terminal-theme fixture must
  extend the live WorkspaceEdit-aware test-server options instead of restoring the baseline shape.
  The lane reads only a sanitized visual whitelist through the loopback backend; it
  must not add a TypeScript Ghostty parser, use `ghostty +show-config` as a dark-profile resolver,
  expose host paths to the browser, or let a persisted workbench opt-out trigger a cold-start read.
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
