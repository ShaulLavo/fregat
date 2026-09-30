# Plan 233: Complete project-tree keyboard operations and file clipboard

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Triage: ZT-14, size L. Depends on Plan 206, Plan 220.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`. Zed evidence is pinned to `933d8d93`.

## Outcome

Open, expand, copy, cut, duplicate, paste, compare, trash and reveal files from the project tree.

## Zed actions and behavior

### Opening

`project_panel::Open`, `project_panel::OpenPermanent`, `project_panel::OpenSplitHorizontal`, `project_panel::OpenSplitVertical`, `project_panel::OpenContextMenu`.

Zed supports preview/permanent opens, directional split opens and a context menu anchored at the selected entry. [crates/project_panel/src/project_panel.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/project_panel/src/project_panel.rs). Preserve Open payloads and focus intent.

### Hierarchy and selection

`project_panel::CollapseAllEntries`, `project_panel::CollapseSelectedEntry`, `project_panel::ExpandAllEntries`, `project_panel::ExpandSelectedEntry`, `project_panel::SelectParent`, `project_panel::SelectNextDirectory`, `project_panel::SelectPrevDirectory`, `project_panel::SelectNextDiagnostic`, `project_panel::SelectPrevDiagnostic`, `project_panel::SelectNextGitEntry`, `project_panel::SelectPrevGitEntry`.

Zed traverses visible tree entries and their directory/diagnostic/Git predicates; expansion controls visibility and parent selects the enclosing directory. [crates/project_panel/src/project_panel.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/project_panel/src/project_panel.rs#L3397).

### Viewport

`project_panel::ScrollCursorBottom`, `project_panel::ScrollCursorCenter`, `project_panel::ScrollCursorTop`, `project_panel::ScrollDown`, `project_panel::ScrollUp`.

Cursor commands align the selected row; ScrollUp/Down moves selection by half a viewport. [crates/project_panel/src/project_panel.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/project_panel/src/project_panel.rs#L3151).

### Filesystem clipboard

`project_panel::Copy`, `project_panel::Cut`, `project_panel::Duplicate`, `project_panel::Paste`, `project_panel::CompareMarkedFiles`, `project_panel::Trash`.

Zed reduces marked entries to disjoint sources, copies or moves on paste, resolves destination names and compares two marked files. Trash passes recoverable removal plus `skip_prompt`. [crates/project_panel/src/project_panel.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/project_panel/src/project_panel.rs#L3534), [crates/project_panel/src/project_panel.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/project_panel/src/project_panel.rs#L2578), [crates/project_panel/src/project_panel.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/project_panel/src/project_panel.rs#L4085).

### Paths and links

`editor::CopyPath`, `editor::OpenSelectedFilename`, `editor::OpenUrl`, `editor::RevealInFileManager`, `project_panel::CopyPath`, `project_panel::RevealInFileManager`, `workspace::CopyPath`, `workspace::CopyRelativePath`.

Copy/reveal follows the focused source owner. Zed resolves a filename at the caret and a URL at the caret or in the selection. [crates/editor/src/editor.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/editor/src/editor.rs#L9047), [crates/editor/src/navigation.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/editor/src/navigation.rs#L1129).

## Existing implementation

[apps/web/src/features/workspace/hooks/use-fs-actions.ts](../apps/web/src/features/workspace/hooks/use-fs-actions.ts) creates, duplicates, moves and
deletes through [apps/web/src/features/workspace/state/file-operations.ts](../apps/web/src/features/workspace/state/file-operations.ts), which updates open
documents and records reversible operations. [apps/web/src/features/workspace/state/tree-intents.ts](../apps/web/src/features/workspace/state/tree-intents.ts)
owns tree intent sequencing; [apps/web/src/features/workspace/hooks/use-tree-keyboard.ts](../apps/web/src/features/workspace/hooks/use-tree-keyboard.ts)
and [apps/web/src/features/workspace/tests/tree-parity-keyboard.browser.tsx](../apps/web/src/features/workspace/tests/tree-parity-keyboard.browser.tsx) cover existing
navigation. [apps/web/src/lib/documents/utils/groups.ts](../apps/web/src/lib/documents/utils/groups.ts) supports split placement.

## Design

Expose narrow tree actions through the existing provider and `FileTree` focus node. Add a
zustand file-clipboard state with typed copy/cut mode, environment/root identity and disjoint
entry IDs. Paste serializes journaled file operations and settles tree, path changes, live
documents and Git/search caches. Use the server's reversible deletion storage for recoverable
trash; expose recovery and report failure if recoverability cannot be provided. Register typed
`tree.open`, `tree.navigate`, `tree.scrollSelection`, clipboard and compare commands; route editor
path/link actions through an Editor host adapter. Preserve marked selection, rename-editing
contexts and open payloads. Declare native file-manager capability; browser hosts retain path
copy while unavailable reveal declines. Reuse shared menus, tooltips and truncation titles.

Keep command IDs, titles, typed arguments and enablement in the command table under
`packages/client-core/src/commands/`; handlers belong to the owning feature and its focus node.
Plan 206 owns bindings as preset data under `apps/web/src/keymap/presets/`, including Linux/macOS
contexts, payloads, section order and key equivalents from the translation inventory. Activate
rows when their owner exists. The focused node may decline; use the shared dispatcher without
local shortcut listeners or inline command chords.

## Steps

- [ ] Add failing tree parity cases for clipboard, filtered navigation, half-page selection and preview/permanent opens.
- [ ] Implement clipboard and collision policy through existing tree intents and the filesystem journal; cover rollback and dirty-document path updates.
- [ ] Wire remaining tree and Editor host actions, recoverable trash and marked-file comparison; enable exact preset payloads.
- [ ] Add `zed-project-tree-commands` using disposable filesystem fixtures and a fixture native reveal adapter.
- [ ] Run the acceptance checks, record screenshot evidence, then commit, push and deploy the implementation.

## Acceptance

Run the focused tree keyboard suite and file-operation tests for copy/cut, ancestor-mark
reduction, collisions, failed paste, dirty moved documents and trash recovery.
`zed-project-tree-commands` uses marked files, context-menu opening, preview/permanent and split
opens, filtered navigation, every viewport action, compare, clipboard and recovery. Owner data
must stay outside fixtures; native reveal tests use an injected host adapter.

Run heavy checks through `bash /work/tmp/wave-heavy/run.sh "<label>" -- env PATH="$PATH" <cmd>`.
Use fixture providers and fixture language servers. Add scenario selectors in
`scripts/agent/selectors.ts`, run `bun run agent:browser scenario <name>` for the named scenario above, then
`bun run agent:browser look`; read screenshots back and record the evidence directory. Run `bun run gates`
and the relevant typecheck. Commit by path, push, and deploy the completed implementation with
`bun run deploy`, adding `--server --restart` when server code changes.

## Out of scope

Permanent-delete behavior changes; cross-machine file transfer; new pane geometry, Plan 237; TUI parity.
