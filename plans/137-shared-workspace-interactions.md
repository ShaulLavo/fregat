# Plan 137: Share workspace interactions across files, chat, editor, and panels

## Status and authorization

- Status: IMPLEMENTED — all seven phases landed 2026-09-24 (`scenario copy-feedback`, `file-label-cohesion`, `sidebar-settings-button`, `bottom-panel-persistence`, `problems-panel-rows`, `lsp-references`, `checkpoint-states`, `session-actions-surfaces`, `search-file-actions`, `git-changes` green). Open items are listed under each phase's As built.
- Priority: P1 for consistent behavior, then P2 for additional entry points.
- Effort: L overall, split into independently verified phases below.
- Risk: MED overall. Session ownership and focus are the main risks.
- Planned at: Platform `c00a60f7`, 2026-09-23, including the existing dirty working tree.
- Dependencies: no unfinished plan must land first. Reconcile overlaps below before editing.
- Categories: correctness, shared UI behavior, product cohesion.

The user requested **one plan covering all seven findings**, not implementation yet. On later
execution, work in the current checkout. Do not create branches, worktrees, commits, pushes, or
PRs unless separately requested. Preserve unrelated staged, unstaged, and untracked work.

## Outcome

A file, conversation, or panel should offer the same applicable actions wherever it appears.
Shared components must own behavior as well as paint: selecting and hiding a pane, identifying
a file, moving through grouped results, reporting a copy result, and explaining an unavailable
checkpoint. Layouts can remain different without silently removing capabilities.

This is not a universal row or panel framework. The existing `ListRow`, `useListbox`,
`VirtualList`, `ToolPane`, `ChatView`, and comparison-document renderer remain the foundations.

## Seven-item coverage and execution order

Finding numbers match the approved audit. Phase letters are execution order.

| Finding | Deliverable                                                               | Phase | Effort / risk |
| ------- | ------------------------------------------------------------------------- | ----- | ------------- |
| 1       | Rails and pane headers share view selection and Hide actions              | C     | M / MED       |
| 2       | Search and changed-file lists share file identity/status presentation     | B     | M / LOW       |
| 3       | Problems navigates file groups continuously like References               | D     | M / MED       |
| 4       | Copy buttons and menus share execution and feedback                       | A     | S–M / LOW     |
| 5       | Timeline and Turn panel share checkpoint availability states              | E     | S / LOW       |
| 6       | Editor-side chat exposes the same applicable session actions as main chat | F     | M–L / MED     |
| 7       | Search offers the common file actions already present in Files and Git    | G     | M / LOW       |

Execution: baseline → A → B → C → D → E → F → G → integrated verification.
A supplies copy execution to F/G; B supplies file presentation to G. Other phases are largely
independent. Complete each migration, including deleting superseded code, before starting another.

## Current state and drift check

Run from `/work/projects/platform`:

```bash
git status --short
git diff --stat c00a60f7..HEAD -- apps/web/src packages/ui/src scripts/agent
git diff --stat -- apps/web/src packages/ui/src scripts/agent
git diff --cached --stat -- apps/web/src packages/ui/src scripts/agent
```

Read the actual diffs for files this plan touches, not only the statistics. The preceding rail
fix is present in the dirty tree: `components/rail-tabs.tsx` computes `activeTab !== tab` and
calls `onSelectTab(tab, open)`; workbench `components/layout.tsx` keeps that rail outside the
collapsible sidebar. Preserve that fix. Do not reconstruct the working tree from HEAD.
The checkout also contains unrelated filesystem undo, editor synchronization, keymap, logging,
and transport changes. Record their ownership before touching a shared file.

These are source-confirmed findings. Except for the preceding rail toggle fix and a filename
display helper check, the audit did not reproduce them through the browser. Baseline drives in
the relevant phase must confirm the claimed observable before implementation.

### 1. Pane capabilities diverge

`apps/web/src/features/workbench/hooks/use-pane-header-menu.ts:43–58`:

```tsx
if (uiMode === 'chat') {
  return paneHeaderMenu({
    activeView: chatModePanels.activeToolTab,
    hidePane: hideChatPane,
    host: 'chat-pane',
    selectView: selectChatView,
    title,
  })
}
return paneHeaderMenu({
  activeView: workbenchPanels.activeSidebarTab,
  hidePane: null,
  host: 'workbench-sidebar',
  selectView: selectSidebarView,
  title,
})
```

`features/workbench/utils/pane-header-menu.ts` duplicates sidebar view labels/order and still
describes the sidebar as always visible. `components/bottom-panel.tsx` builds its own tab bar,
while Terminal and Problems in `features/chat-mode/components/tool-pane.tsx` get the shared
header. The test `features/workbench/utils/tests/pane-header-menu.test.ts` explicitly expects
the old missing-Hide behavior; replace that expectation as part of this change.

### 2. File identity and change status disappear in some hosts

`features/search/components/name-match-row.tsx` renders a generic `FileTextIcon` and
`searchMatchDisplay(match, query)`. In `features/search/utils/match-display.ts:22`:

```ts
if (match.kind === 'name') return searchQueryDisplay(match.path, query, options)
```

A match in a long directory path can consume the visible window and hide the basename.
`components/git-file-row.tsx` already renders basename first, then muted directory, a file-type
icon, status, and optional diff counts. Content Search's `components/file-group.tsx` also keeps
basename first.

`features/chat/utils/turn-diff-tree.ts:79` discards the checkpoint's change kind:

```ts
currentDirectory.files.push({
  kind: 'file',
  name: fileName,
  path: segments.join('/'),
  stat,
})
```

The timeline row therefore cannot display added/deleted/renamed status. The same turn's panel
does display it through `features/chat-mode/components/turn-files.tsx` and `GitFileRow`.
Checkpoint `kind` is an open string; `chat-mode/utils/turn-file-status.ts` deliberately falls
back to modified for unknown kinds. Checkpoint files currently have no old-path field.

### 3. Problems has one keyboard list per file

`features/workbench/components/diagnostics-panel.tsx:61` maps resources to separate
`DiagnosticList` instances. Each `diagnostic-list.tsx:29–50` creates its own active ID and
`useListbox({ role: 'listbox', ... })`. References instead flattens groups into one row sequence
and one `useListbox({ role: 'tree', ... })` in
`features/editor/components/language-server-references-pane.tsx:69–89`.

### 4. Copy execution and feedback are inconsistent

`lib/clipboard.ts` already handles unavailable access, success toast, failure toast, and one
structured failure log. Chat's `markdown-copy-button.tsx`, `assistant-message-copy-button.tsx`,
`provider-sign-in-dialog.tsx`, and `proposed-plan-card.tsx` repeat clipboard execution and/or
timers. `features/settings/components/row-actions.tsx:57` bypasses all feedback:

```tsx
<DropdownMenuItem onClick={() => void navigator.clipboard?.writeText(id)}>
  Copy setting ID
</DropdownMenuItem>
```

Assistant response copying also transforms citations with `codexFileCitationsMarkdown`.
That transformation is intentional and must remain at its domain caller.

### 5. One checkpoint receives conflicting explanations

`features/chat-mode/components/tool-pane.tsx:200`:

```tsx
if (turnSummary.status !== 'ready' || turnSummary.files.length === 0) {
  return <p>No checkpoint diff for turn {turnSummary.checkpointTurnCount}.</p>
}
```

`features/chat/components/assistant-changed-files-section.tsx:201` separately labels missing
and error. It also returns null for zero files before rendering any status. Contracts define
`OrchestrationCheckpointStatus` as `ready | missing | error`; pending is local absence while
a selected checkpoint is being acquired, not a new server status.

### 6. Session actions depend on which layout hosts the conversation

`features/chat/components/chat-panel-header.tsx` only supplies New and Conversation history.
`features/chat-mode/components/stage-header.tsx:65–67` supplies title status, context usage,
and `StageSessionMenu`. Both conversation bodies already mount the same `ChatView`.

`features/chat-mode/hooks/use-session-menu.ts` combines domain actions with rail-specific
scope/open/draft/rename behavior. `use-session-actions.ts` owns real mutations and navigation
reconciliation. Delete and snooze dialogs currently mount only in
`features/chat-mode/providers/session-controller.tsx:108`. Merely sharing the menu button
would leave editor-side actions without their dialog owner.

### 7. Search lacks existing file-menu actions

Files' `features/workspace/hooks/use-row-menu.ts` and Git's
`features/git/hooks/use-file-menu.ts` already use `copyTextToClipboard` and the shared
`keymap/menus/utils/copy-path-section.ts`. Search rows currently expose open/toggle/replace
without a context menu. Add access to the existing actions rather than inventing another
menu implementation or requiring users to relocate a search result in Files.

## Ownership and implementation rules

- `packages/ui/src/patterns/` owns domain-free presentation and interaction. It cannot know
  workspace paths, Git, sessions, navigation, or RPCs.
- App components in `apps/web/src/components/` own reusable file cells and action controls.
  App providers/hooks compose feature owners where needed. `lib/` owns shared domain models
  only when it has two outside consumer groups or supports a qualifying shared module.
- Features are leaves. Do not add feature-to-feature imports or hide one through a barrel.
  A shared `lib/` module cannot import a feature. Move the necessary dependency closure or
  inject a narrow capability from app composition. Remove obsolete allow-list entries after
  moving callers; do not expand the allow-list to excuse this work.
- One component/hook per file; pure helpers in `utils/` or an appropriate shared model.
  Stateful stores belong in `state/` or providers. No nested ternaries; maximum nesting three.
- Retain `ListRow`, `useListbox`, `ToolPane`, `MenuSurface`, existing menu models, density/theme
  tokens, native full-value titles, and tooltips for icon controls. Paint each pane once.
- Read/write async state belongs to TanStack, including shared mutation keys, serialization
  where already required, and cache settlement. Transient copied confirmation is presentation,
  not a second async pending/error state machine. Do not retry clipboard permission failures.
- Keep `ScopedSessionRef`, environment ownership, filesystem brands, and navigation commands.
  Do not substitute a session ID or display path for its scoped identity.
- No manual memoization unless required by identity/correctness or measured. Run
  `compiler:memos` before/after touching existing memos and preserve lost contextual types.
- Use structured error helpers and one wide log per operation. Never log copied text, message
  contents, or paths merely to prove a clipboard failure.
- Greenfield migration: move all callers and delete superseded APIs in the same phase.

Exemplars: `docs/pattern-layer.md`, `docs/workspace-rails.md`, `docs/web-layering.md`,
`components/git-file-row.tsx`, `keymap/menus/utils/copy-path-section.ts`, and the References
pane's grouped keyboard model. Apply the current repository `AGENTS.md` and relevant
TypeScript, React, TanStack, never-nester, and verify-fregat skills when executing.

## Scope and boundaries

Allowed production changes are the seven owner/caller groups cited above and these additions:

- App pane-host context/provider/hook under `providers/` and `hooks/`, plus shared pane-menu
  descriptors in `keymap/menus/utils/`. Wire workbench/sidebar/bottom and chat tool layouts.
- `components/file-label.tsx`, optional separate file-status cell, their pure models under
  `components/utils/` or qualifying `lib/`, and direct file-row consumers in Search/Git/chat.
- A domain-free grouped-list helper under `packages/ui/src/patterns/` only if both Problems
  and References actually consume it; add its exact package export and focused tests.
- Shared clipboard execution at `lib/clipboard.ts`, shared mutation definitions/keys, a
  `hooks/use-copy-feedback.ts` or `components/copy-button.tsx`, and all existing direct callers
  of the migrated API. Do not duplicate both a hook and component unless each has a use.
- `lib/checkpoint-availability.ts` and its timeline/Turn-panel callers.
- Shared session action hooks, controls, dialog ownership, and menu models in app composition;
  move only the required policy/state/mutation dependency closure and all its existing callers.
- Shared file-menu sections in `keymap/menus/utils/`, Search's local menu wiring, and Files/Git
  adapters. Existing filesystem/staging implementations remain authoritative.
- Focused tests, shared test fixtures, browser scenarios/selectors, feature-map entries,
  stale boundary allowances, `docs/pattern-layer.md`, and `docs/workspace-rails.md`.
  Browser fixture scope includes `scripts/agent/scenarios/native-provider-verification.ts`
  and a new `scripts/agent/fixtures/native-checkpoint.mjs` for deterministic local checkpoints.

No backend protocol, contract schema, dependencies, persistent settings, storage migrations,
native/TUI clients, sibling Editor checkout, or new session lifecycle actions. No new generic
document-tab system. Do not unify Search sidebar/editor click semantics in this plan; that
was considered during audit but is outside the seven selected findings.

Keep file-picker select/commit behavior, the file tree's shadow-root keyboard/controller,
editor-specific virtualization, terminal `KeepAlive` and mounted hosts, and the existing diff
renderer. File labels may share parts without changing any of those interaction models.

Overlaps: Plan 101 covers truncation more broadly; implement only these file-label sites and
retain full-value recovery. Plan 102 covers broader focus/scroll work; limit this plan to
Problems' grouped traversal. Plan 133's markdown-selection serialization and Plan 135's broad
async migration are not part of clipboard-button consolidation. Plan 126 owns session lifecycle
semantics: reuse them. Plan 136 owns file operations/undo: menu composition must preserve them.
Record resolved overlap in this plan/index instead of creating competing implementation plans.

## Verification commands

All commands below start at the repository root unless a `cd` is shown. No install is needed.

| Check                               | Command                                                                                  | Expected                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Web types                           | `bun run --cwd apps/web typecheck`                                                       | Exit 0                                         |
| Boundaries                          | `bun run boundaries:check`                                                               | Exit 0; no new feature edges                   |
| Whole-tree gates                    | `bun run gates`                                                                          | Duplicate/design/compiler/error gates pass     |
| Focused app tests                   | `cd apps/web && bun --bun vitest run --project node --project dom <explicit-test-paths>` | Named tests run and pass, not an empty match   |
| UI package helper tests, if changed | `cd packages/ui && bunx vitest run <explicit-test-paths>`                                | Named tests pass under package compiler config |
| Changed-file lint                   | `bunx oxlint <explicit-changed-ts-and-tsx-paths>`                                        | Exit 0                                         |
| Changed-file format                 | `bunx oxfmt --check <explicit-changed-paths>`                                            | Exit 0                                         |
| Patch hygiene                       | `git diff --check`                                                                       | No whitespace errors                           |
| Browser health                      | `bun run agent:browser look --doctor`                                                    | Existing app ready, no alert                   |
| Browser scenario                    | `bun run agent:browser scenario <name>`                                                  | Completed, required assertions executed        |
| Logs                                | `bun run logs --since <run-start>`                                                       | No unexplained errors from changed operations  |

Replace angle-bracket arguments with the exact files/names collected in the phase. Do not run
unrelated full suites to manufacture confidence. App tests use `test/fixtures.ts`, existing
provider render helpers, and the real in-process server. Mock only browser clipboard or another
external boundary; do not mock our feature modules. Add browser selectors centrally in
`scripts/agent/selectors.ts` and scenario registrations in `scripts/agent/scenarios/index.ts`.

The phase test commands below are exact target selections, including tests this plan creates.
Run each after implementing its phase; every named file must exist and every selected test must
pass. These commands supplement the browser drives specified in each phase.

```bash
# A
bun run --cwd apps/web test src/lib/tests/clipboard.test.tsx src/components/tests/copy-button.test.tsx src/features/chat/components/tests/proposed-plan-card.test.tsx
# B
bun run --cwd apps/web test src/components/tests/file-label.test.tsx src/features/search/tests/search-match-row.test.ts src/features/chat/utils/tests/changed-files-presentation.test.ts src/features/chat/components/tests/assistant-changed-files-section.test.tsx
# C
bun run --cwd apps/web test src/features/workbench/utils/tests/pane-header-menu.test.ts src/features/workbench/components/tests/tool-pane-header.test.tsx src/providers/tests/pane-host-provider.test.tsx
# D
bun run --cwd apps/web test src/features/workbench/utils/tests/diagnostic-rows.test.ts src/features/workbench/components/tests/diagnostics-panel.test.tsx
# E
bun run --cwd apps/web test src/lib/tests/checkpoint-availability.test.ts src/features/chat/components/tests/assistant-changed-files-section.test.tsx src/features/chat-mode/components/tests/checkpoint-state.test.tsx
# F
bun run --cwd apps/web test src/features/chat-mode/utils/tests/session-menu.test.ts src/features/chat-mode/components/tests/session-menu.test.tsx src/features/chat-mode/hooks/tests/use-session-removal.test.tsx src/components/tests/session-actions.test.tsx
# G
bun run --cwd apps/web test src/features/workspace/utils/tests/row-menu.test.ts src/features/git/utils/tests/file-menu.test.ts src/features/search/tests/file-menu.test.tsx
```

## Phase 0: Capture a baseline and make the gaps executable

1. Read current owner files and capture the dirty baseline. Confirm each excerpt still describes
   the running path. If a finding is already fixed, verify it and mark that item satisfied rather
   than rebuilding it.
2. Run the doctor against the existing dev server. Never start another server. Read current logs.
3. Extend `sidebar-settings-button` to inspect header Hide in both modes. Record the pre-fix gap.
4. Use disposable fixture workspaces for Search/Problems. The existing
   `scripts/agent/scenarios/problems-panel-rows.ts` types into repository files and asserts a list
   per file; replace its setup with a disposable two-file fixture and change the obsolete list
   assertion when implementing D. Do not run its current mutation path against the user's files.
5. Use existing chat fixtures and real-server tests for checkpoint/session cases. The
   `chat-changed-files` scenario can report `treeAvailable: false`; that is not coverage. Never
   mutate, archive, delete, or send a message to an existing user session for verification.
6. Build a browser-reachable checkpoint fixture for B/E. In-process test fixtures cannot seed
   the running dev server. Extend `isolatedNativeScenario` in
   `scripts/agent/scenarios/native-provider-verification.ts` with explicit worktree targeting;
   these scenarios must never use its current `shell.worktrees[0]` fallback. Create and commit
   a disposable Git workspace using `createGitFixture`/`fixtureGit`, open it with
   `openFixtureWorkspace`, and resolve its exact registered path/project/worktree from the real
   orchestration shell. Pass that scoped worktree to session creation.
7. Add `scripts/agent/fixtures/native-checkpoint.mjs`, following the native Codex protocol
   executable in `scripts/agent/fixtures/native-codex.mjs`. It uses no real provider credentials
   or paid tokens. Validate its working directory against the explicitly recorded fixture path;
   fail before any write if they differ. During a controlled turn, modify/add/delete/rename only
   named fixture files, then emit normal completion so the real server produces a checkpoint.
   A second no-edit turn supplies ready-empty state; a controlled completion barrier allows the
   pending state to be inspected without timing sleeps. Known/unknown status rendering remains
   covered in component tests, not by editing the live server's projection or database.
8. Cleanup has separate owners. In `finally`, stop and delete every created orchestration
   session through `dispatch` in `scenarios/chat-verification.ts`; remove only the fixture
   provider setting, preserving concurrent settings changes; wait for the native process exit.
   Remove only project/worktree registrations created by this run through their existing cleanup
   APIs, restore the original browser address, then release the disposable Git directory with
   `releaseFixture`. That function only removes directory/process resources; it does not delete
   orchestration sessions. Record and assert session/provider/process cleanup independently.

**Verify:** doctor completes; baseline evidence records each tested gap and relevant initial
state. Use small failing component/domain tests for unavailable clipboard and checkpoint errors
that are impractical to induce live. Do not add production fixture switches.

## Phase A: Share copy execution and confirmation (finding 4)

1. Keep a single clipboard boundary in `lib/clipboard.ts`. Return an explicit success/failure
   result so a button only displays Copied after success. Route unavailable access and rejected
   writes through the same error treatment and one structured log without the payload.
   Owner decision 2026-09-24: the boundary tries every write method in order, newest first —
   `navigator.clipboard.writeText`, then `navigator.clipboard.write` with a `ClipboardItem`,
   then the deprecated `document.execCommand('copy')` — and fails only when all are missing or
   refused. The log names each method tried and its error name, never the text.
2. Provide menu feedback (one success toast) and inline feedback (one temporary checkmark and
   accessible label, no extra success toast). Preserve caller labels and content transforms.
   Repeated success restarts the confirmation timeout; unmount clears it.
3. Make React and non-React callers use the same mutation definition/key via `useMutation` or
   the existing `lib/mutations/run.ts`. Do not queue behind unrelated copies or automatically
   retry. Verify the browser's user-activation requirement before changing execution timing;
   clipboard invocation must still work from the original click in supported browsers.
4. Migrate Settings' ID/JSON actions; chat's Markdown/assistant copy buttons, proposed-plan menu,
   and sign-in command copy; retain existing Files/Git/Logs/menu callers. Preserve citation
   conversion and exact JSON/plan output. Leave native selection copy/paste, HTML clipboard
   serialization, and editor clipboard events alone.
5. Delete duplicate clipboard try/catch and copied-timer implementations in migrated callers.

**Tests:** add `src/lib/tests/clipboard.test.tsx` (the `dom` project; the fallback needs a DOM) and
`src/components/tests/copy-button.test.tsx`. Cover unavailable,
rejected, success, repeated clicks, unmount cleanup, no false success, and one feedback event.
Retain `features/chat/components/tests/proposed-plan-card.test.tsx` payload assertions.

**Verify:** focused app tests for those files, web types, changed-file lint. Add/run
`scenario copy-feedback` for real copy from Settings, a chat button, and a file menu; inspect
clipboard output in a fresh browser context and success/error presentation in boundary tests.

## Phase B: Share file labels and changed-file status (finding 2)

1. Extract the icon/basename/muted-directory presentation from `GitFileRow` into app-owned
   `FileLabel`. Keep the row container, selection, status/actions columns, full-row title,
   indentation, and virtualization with the caller. Accept display/highlight slots rather than
   making the component import Search's query model.
2. Migrate Git file rows, Search content-group headers, Search editor file headers, and filename
   rows to those parts. A filename result always shows its basename. Directory matches remain
   highlighted in the secondary text, with the full path recoverable from the row title. Keep
   content excerpts on their current match-centered window; do not change content highlight ranges.
3. Preserve checkpoint change kind in the timeline tree node, distinct from its `kind: 'file'`
   discriminator. Share the existing turn-kind-to-status mapping and status cell with the Turn
   panel. Unknown strings still read as modified. Do not invent rename source paths absent from
   the contract, or apply Git mutation actions to historical checkpoint rows.
4. Keep folder aggregation/expansion and zero-line changes. Tree leaves may suppress redundant
   directory text because their ancestors already identify it; status and recovery stay available.

**Tests:** add `src/components/tests/file-label.test.tsx`; extend
`features/search/tests/search-match-row.test.ts`,
`features/chat/utils/tests/changed-files-presentation.test.ts`, and
`features/chat/components/tests/assistant-changed-files-section.test.tsx`.
Cover long directory-only matches with a visible basename, basename matches, Unicode and narrow
rows, exact full titles, known/unknown change kinds, and rename/zero-count changes.

**As built:** workspace Search sends `includeNames: false` (since `8aa2bea9`), so the live panel
never produces a filename row. `SearchNameMatchRow` is fixed and covered by
`features/search/tests/name-match-row.test.tsx`, but only a content group header is reachable in the
browser; the scenario drives that. Checkpoint file paths are relative to the machine root
(`work/tmp/…/a.txt`), so the Turn panel's directory column and the timeline's top folder show the
whole checkout path. That predates this plan and is left alone.

**Verify:** those focused tests and web types. Add/run `scenario file-label-cohesion` using
Search and Git in a disposable nested workspace; include checkpoint rows using the existing
native fixture setup from Phase 0 and inspect both timeline and Turn-panel rendering. A skipped checkpoint
case is explicitly incomplete. Inspect screenshots at normal and narrow pane widths.

## Phase C: Give pane hosts one action contract (finding 1)

1. Introduce an app-owned pane-host context. Its value describes the actual host: editor sidebar,
   editor bottom panel, or chat tools; available tab descriptors; selected tab; visibility; and
   narrow `select`, `toggle`, and `hide` actions. A discriminated host type must prevent selecting
   a bottom-panel-only tab in the sidebar. Derive allowed tab IDs from the existing arrays/types.
2. Mount the provider at each layout's host boundary, wrapping both the rail/tab strip and pane
   header. Keep terminal lifetime providers above it and leave native terminal hosts mounted.
   Do not infer header ownership solely from global `uiMode`.
3. Rails toggle, header menu choices select/reveal, and Hide only closes that host. Both paths
   call the existing navigation APIs and retain the last selected tab. The editor rail remains
   visible after hiding, as established by the preceding fix.
4. Make `PaneHeaderMenu` and `ToolPaneHeader` consume this contract. Add the same applicable menu
   to the editor bottom-panel bar without replacing terminal tab/action controls. Delete copied
   view lists and the obsolete always-visible sidebar assumption/tests. Keep one menu model in
   `keymap/menus/utils/`, not app-specific navigation inside `packages/ui`.
5. Update `docs/workspace-rails.md` with provider ownership and select-versus-toggle semantics.

**As built:** each view carries `select` and `toggle` bound by the provider from that host's own tab
list, so callers never narrow a string back to a tab; the menu model moved to
`keymap/menus/utils/pane-header-menu.ts` with its test beside it, `ToolRail` was deleted, and the
workbench → chat-mode allow-list entry went stale and was removed.

**Tests:** replace obsolete assertions in `features/workbench/utils/tests/pane-header-menu.test.ts`;
extend `features/workbench/components/tests/tool-pane-header.test.tsx`; add
`src/providers/tests/pane-host-provider.test.tsx` covering host isolation, hide/reopen, view
switching, last selection, and unavailable tabs.

**Verify:** focused tests, web types, boundaries; run `scenario sidebar-settings-button` with
header-hide and bottom-panel cases, then existing `scenario bottom-panel-persistence`.
The latter must show no terminal socket closure from hiding or changing layout.

## Phase D: Make Problems one grouped results tree (finding 3)

1. Build one flattened sequence of file groups and diagnostics in a workbench `utils/` model.
   Use resource URI plus stable diagnostic identity; file-local numeric indices cannot identify
   rows across resources. Track one active row and collapsed-file set for the whole pane.
2. Use one `useListbox({ role: 'tree' })`, matching References: arrows traverse groups/results,
   Left/Right collapse/expand, Enter on a group toggles and Enter on a diagnostic opens its exact
   location. Cursor movement previews the target without moving DOM focus away from the tree.
3. Retain per-file headings, severity, complete multiline message bodies, native recovery titles,
   and current click/preview behavior. Use measured flow for variable-height messages; do not
   force them through a fixed-height virtualizer.
4. Reuse the existing listbox directly. Extract a grouped traversal helper into `packages/ui`
   only if it eliminates matching logic from both this pane and References; do not create a
   second keyboard controller. Remove the per-file `DiagnosticList` state owners.
5. When diagnostics refresh/remove a file, retain the active row if present, otherwise select a
   deterministic surviving neighbor. Keep `aria-activedescendant` valid and DOM focus stable.

**As built:** no `packages/ui` helper — the flattening is domain-specific in both panes and
`useListbox` already owns the traversal. `toggledPathSet` gained a second feature consumer and
moved to `lib/toggled-set.ts`. The pane root now takes `flex-1`: in the bottom panel's flex body it
had been shrinking to its content, so the empty state sat off-centre before this plan.

**Tests:** add `features/workbench/utils/tests/diagnostic-rows.test.ts` and
`features/workbench/components/tests/diagnostics-panel.test.tsx`. Use two files, duplicate messages
at different locations, multiple severities, collapsed groups, and removal of the active result.

**Verify:** focused tests, web types. Repair and run `scenario problems-panel-rows` on its new
disposable fixture; require one list Tab stop and arrow traversal across the two files. Run
`scenario lsp-references` only if its shared helper/caller changed. Inspect resulting screenshots.

## Phase E: Share checkpoint availability (finding 5)

1. Add a pure `lib/checkpoint-availability.ts` selector derived from `ChatTurnDiffSummary` and
   explicit local loading context. Use discriminated states: pending, missing, error, empty,
   available. Do not add a contract status or infer permanent pending solely from a falsy value
   when no turn is selected. Existing no-turn selection remains separate.
2. Make timeline changed-files and the Turn panel consume the same result and labels. Evaluate
   missing/error before an empty-files early return. A ready empty summary says no changed files;
   a failure says checkpoint error; a missing checkpoint is identified as missing.
3. Use existing loading/error/empty components with layout-appropriate wrappers. Pending never
   looks empty. Only show recovery actions backed by an actual supported operation; do not add a
   fake Retry or start provider work to regenerate a checkpoint.
4. Keep local errors opening an available diff distinct from summary availability. Retain the
   existing comparison-document navigation and renderer.

**As built:** `canOpenCheckpointDiff` was the `available` predicate under another name; its callers
use the selector and it is deleted. The `available` state carries its summary. In the timeline a
ready turn with no files still renders nothing — one "No changed files" line under every chat-only
reply would be noise — while missing and error with no files now say so. The Turn panel says all
three. Pending cannot be reached in the browser: a turn id only appears with its summary.

**Tests:** add `src/lib/tests/checkpoint-availability.test.ts` with every state; extend
`features/chat/components/tests/assistant-changed-files-section.test.tsx` and add
`features/chat-mode/components/tests/checkpoint-state.test.tsx` for matching explanations,
including missing/error with zero files and available → error transitions.

**Verify:** focused tests and web types; add/run `scenario checkpoint-states` for pending,
available, and ready-empty using the Phase 0 native fixture against the running server. Missing,
error, and unknown-kind cases use real-server/component fixtures without corrupting live state.
Report the browser and component coverage separately rather than claiming every state ran live.

## Phase F: Share session actions across main and editor-side chat (finding 6)

1. Separate the common session action policy from `useSessionMenu`'s rail-only controls. Common
   actions include rename, archive/unarchive, pin/unpin, snooze/unsnooze, settle/unsettle,
   mark-unread/wake, stop, delete confirmation, supported title regeneration, and copy identity
   actions. Preserve existing visibility/eligibility rules; do not offer unsupported actions.
   Rail project filtering, row opening, and draft placement remain local contributions.
2. Move the common menu definition into `keymap/menus/utils/` and common action hooks/controls
   into app composition (`hooks/`, `components/`, `providers/`). Pure policy shared by both
   features may move into `lib/session-actions/`. Move all direct callers and only the dependency
   closure needed for this ownership change; a `lib` module may not reach back into features.
   Keep transport/projection integration in app composition adapters when moving it would widen
   this into an orchestration rewrite. Do not hide the old rail dependency behind a new filename.
3. Existing `use-session-actions.ts` mutations, scoped keys, environment dispatch, removal
   reconciliation, and confirmation settings remain the behavioral authority. Extract/rehome
   them as needed rather than implementing a second mutation path. Share authoritative policy
   evaluation so switching headers cannot change which actions are allowed.
4. Mount one shared session dialog owner above both mode layouts, under the active environment
   and query/navigation providers. Move session Delete/Snooze mounts out of the chat-only
   controller. Also move the `WorktreeManager` modal mount to shared app composition: the existing
   Delete dialog's "Manage worktrees" action opens it, so leaving that mount in chat mode would
   strand the action in editor mode. Preserve its scoped project target and existing cleanup
   policy; this is an owner relocation, not a redesign of worktree operations. Project rename/
   delete dialogs remain with their owner. The dialog owner uses scoped session refs, not the
   currently selected row at confirmation time.
5. Share the session-actions button in `StageHeader` and `ChatPanelHeader`. Reuse the existing
   rename control with an explicit invocation target for rail, main header, or sidebar header.
   Opening one must not swap another header into rename mode. Keep main/sidebar New and History
   placement appropriate to their layout; they need not show identical chrome.
6. Hide session-only controls for a draft. Archive/delete reconcile the correct open surface;
   changing modes while a dialog is open preserves its target. Add no provider token consumption
   to verification and never exercise lifecycle actions against a user's real conversation.

**As built:** the common menu is `keymap/menus/utils/session-actions-menu.ts`; the rail keeps
`sessionMenu` in chat-mode, which adds Open, New Session and Show Only This Project, so the stage
header no longer offers those three. `hooks/use-session-menu-actions.ts` builds the shared action set,
`hooks/use-session-rail-item.ts` gives both headers the rail's view of a session,
`hooks/use-session-renaming.ts` isolates rename per surface ('rail' | 'header' | 'sidebar'), and
`SessionRename` plus `SessionActionsButton` moved to `components/`. `components/session-dialogs.tsx`
mounts Delete, Snooze and the worktree manager in `WorkspaceView`, above the mode switch.
Found on the way: Rename from the stage header was already broken on the mesh — the open popup pulled
focus back from the new field, whose blur ended the rename. Menu action items now take `takesFocus`;
the surface runs such an item from `onOpenChangeComplete` and skips focus restore. Not covered: two
environments holding the same unscoped session id (the harness has one environment).

**Tests:** retain `features/chat-mode/utils/tests/session-menu.test.ts`,
`features/chat-mode/components/tests/session-menu.test.tsx`, and
`features/chat-mode/hooks/tests/use-session-removal.test.tsx`, updating imports to rehomed owners.
Add `src/components/tests/session-actions.test.tsx` to compare both header entry points for the
same scoped session, eligibility, pending state, rename isolation, canceled dialogs, and two
environments containing the same unscoped session ID. Verify exact command target and navigation.
From each Delete entry point, open Manage worktrees, assert the matching environment/project,
then cancel without deleting a worktree.

**Verify:** those focused tests, web types, boundaries and changed-file lint. Add/run
`scenario session-actions-surfaces` with a disposable metadata session: open both menus, rename,
pin/unpin, snooze/unsnooze, cancel delete, archive/unarchive, and verify state in both layouts.
Cover stop/title-generation disabled/eligible policies in real-server fixtures without running
a paid provider turn. Cleanup only the fixture session and restore selection.

## Phase G: Offer common file actions in Search (finding 7)

1. Compose shared Open File and Copy Path/Copy Relative Path sections using the existing menu
   model and `copyPathSection`. Files/Git/Search supply scoped resource identity, display labels,
   and narrow callbacks. Use existing document commands for opening and Phase A for copy.
2. Wire Search filename rows, content file-group headers, and content-match rows in sidebar and
   editor Search to the shared menu. Opening a content match retains its exact line/column;
   opening a file heading/filename opens that file. Preserve root/remote environment ownership.
3. Support right-click plus Shift+F10/ContextMenu on the selected row, following Git's existing
   `MenuSurface` integration. Opening a menu must not also open the file, toggle a group, or run
   replace. Closing returns focus to the original list/editor result, including virtual rows.
4. Preserve Git's Open Changes/stage/discard and Files' rename/create/delete/undo contributions.
   Search gains the nonmutating common actions, not every filesystem mutation. Deleted historical
   files retain unavailable Open File behavior; copying a known path can still be available.
5. Use existing absolute/relative path resolvers, not display-string concatenation. File-tree
   directories retain their own behavior and are not presented as openable files.

**As built:** `keymap/menus/utils/open-file-item.ts` is the shared item; Files' "Open" became
"Open File". Search's menu is `features/search/utils/file-menu.ts`, mounted once per list (sidebar
`ResultsView`, search-editor surface), with a small context carrying the opener to the editor's file
headers. Match lines inside the search editor are an embedded editor, so they get the menu through
Shift+F10 on the active line, not right-click. The Open items take focus to the editor; everything
else returns focus to the list through the new `MenuSurface` `returnFocusTo`, because the Search
pane's own focus target would pick its input.

**Tests:** retain `features/workspace/utils/tests/row-menu.test.ts` and
`features/git/utils/tests/file-menu.test.ts`; add
`features/search/tests/file-menu.test.tsx` for all row types, exact payloads, disabled states,
context-key entry, action activation, focus restoration, and no accidental row action.

**Verify:** focused tests, web types, boundaries. Add/run `scenario search-file-actions` on a
disposable nested workspace in both Search presentations; compare copy results with Files/Git,
open a line match, close the menu with Escape, and verify selected row and focus. Run existing
`scenario git-changes` if its adapter changed.

## Integrated verification and completion

1. Run changed-file lint/format, web types, boundaries, `bun run gates`, and `git diff --check`.
   Run only applicable focused tests; record each actual command and result. Do not update
   expected values solely to silence failures or widen census allowances.
2. Run the phase browser drives against the existing dev server and read their screenshots.
   Compare compact/cozy and light/dark for file rows and header controls using scoped browser
   settings that are restored afterward. Exercise normal/narrow panel widths. No overlap,
   missing recovery titles, extra focus stops, or doubled translucent backgrounds.
3. Capture evidence under the verify-fregat directory, inspect console/network failures and the
   exact log window, and register the scenarios in the feature map. Fixtures release through
   the Phase 0 cleanup sequence: orchestration session/provider cleanup first, then process and
   filesystem cleanup through `scripts/agent/fixture-workspace.ts`. Assert both separately.
   No fixture absence or skipped assertion counts as a pass.
4. Review the diff against the original dirty baseline. Confirm all seven findings have tests,
   actual owners, migrated callers, and no duplicate implementation left behind. Shared code
   must have real consumers; delete empty wrappers, obsolete tests, and stale import allowances.
5. At implementation completion, follow the repository's deployment requirement: verify `/work`
   mount/free space, then run the following command:

   ```bash
   bun run deploy --slug=shared-workspace-interactions --reason='Share workspace interactions across files, chat, editor and panels'
   ```

   This plan is web-only; preserve server/terminal lifetime. Reconcile any unrelated dirty
   protocol changes before publishing the checkout. A prior rail deployment observed a missing
   file-operation-history route on the older server; do not treat that known mismatch as proof
   this plan requires a server restart or silently claim a clean deployment check.

6. Verify `/platform/release` and run the applicable browser drives against the mesh URL using
   `--url https://omarchy.mesh.shaulavo.dev/platform/` and
   `OBSERVABILITY_DIR=/work/platform-production/logs`. Inspect screenshots and log windows.
7. Record the delivery/evidence in stable docs, then follow the repository cleanup policy:
   delete this completed executable plan and replace its inventory link with the delivery
   reference. If incomplete, retain this file with exact remaining items. Do not deploy merely
   for writing or reviewing this plan.

### Machine-checkable acceptance

- [ ] Typecheck, scoped lint/format, boundaries, whole-tree gates, and diff hygiene exit 0.
- [ ] Both sidebar modes hide through their header and reopen through their rail; the bottom
      host hides independently, and terminal persistence checks pass.
- [ ] Filename Search keeps the basename visible; timeline and Turn-panel rows expose the same
      change kind; full path recovery and existing content-match ranges pass their tests.
- [ ] Problems has one focus container and valid active descendant across two or more files;
      preview/open, collapse, and refresh/removal tests pass.
- [ ] Migrated explicit copy actions have one execution boundary; no duplicate direct
      `navigator.clipboard.writeText` remains in the named chat/Settings callers. Native
      selection-copy handlers remain separate. Success/failure/payload tests pass.
- [ ] Checkpoint availability matrix passes for both hosts, including error/missing with no files.
- [ ] Both chat headers expose the same applicable session actions; scoped targeting, mutation
      policy, dialog ownership, rename isolation, and removal navigation tests pass.
- [ ] Search file menus work through pointer and keyboard; copied paths and opened locations
      match Files/Git and do not activate replace or collapse inadvertently.
- [ ] Browser evidence names every executed case, includes inspected screenshots, and has no
      unexplained regression attributable to the changes. Missing fixture cases are outstanding.
- [ ] All modified production files belong to the seven scopes; unrelated dirty work is preserved.
- [ ] Mesh release and post-deploy checks are recorded, or a concrete deployment blocker is stated.

## Stop and resolve rather than improvising

Pause the affected phase, continuing independent ones where possible, if the live code disproves
its finding, ownership cannot be separated without changing session/transport semantics, or the
fix needs an out-of-scope server contract. Reconcile ordinary line-number drift locally. Report a
real product decision or destructive cleanup conflict instead of changing behavior silently.
Do not reset other work to make a gate pass. Establish whether a failure predates this plan and
record the evidence. If the same focused verification fails after two reasonable fix attempts,
revisit the assumed owner/behavior before adding another workaround.

## Maintenance

New pane hosts supply the shared actions; new file lists compose the label and applicable menu
sections; new session entry points use scoped action policy and the common dialog owner. Tests
should compare consumers of the same domain object, not snapshots of duplicated JSX. A new UI
variant is allowed to change layout, but a missing capability or different failure explanation
must be an explicit domain decision rather than an accidental fork.
