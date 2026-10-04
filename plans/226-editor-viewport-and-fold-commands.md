# Plan 226: Complete viewport, folding and presentation commands

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Depends on Plan 207, Plan 204, Plan 206. Size: M. Triage item: ZT-07.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`. Zed behavior is pinned to
  `933d8d93819c749a607e561883855a9b95c79cea`.

## Outcome

Scroll by display lines or pages with caret-margin handling, place the caret at the
top/center/bottom, toggle folds and line numbers, and fold at levels eight and nine.

## Covered Zed actions and behavior

`editor::FoldAtLevel_8`; `editor::FoldAtLevel_9`; `editor::FoldSelectedRanges`; `editor::LineDown`; `editor::LineUp`; `editor::PageDown`; `editor::PageUp`; `editor::SaveLocation`; `editor::ScrollCursorBottom`; `editor::ScrollCursorCenter`; `editor::ScrollCursorTop`; `editor::ToggleFocus`; `editor::ToggleFold`; `editor::ToggleFoldAll`; `editor::ToggleFoldRecursive`; `editor::ToggleLineNumbers`.

- `editor::LineDown`, `LineUp`, `PageDown`, and `PageUp` scroll by one display line
  or one viewport. Zed then clamps any caret outside the visible cursor margin,
  collapsing that selection to the new head. Selections remaining inside the margin
  stay unchanged. This corrects the triage's unconditional preservation claim. See
  [crates/editor/src/element.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/element.rs#L424) and
  [crates/editor/src/scroll.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/scroll.rs#L864).
- `ScrollCursorTop`, `ScrollCursorCenter`, and `ScrollCursorBottom` position the
  newest caret in the viewport without changing selection, accounting for margins
  and headers. See [crates/editor/src/scroll/actions.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/scroll/actions.rs#L65).
- `ToggleFold`, `ToggleFoldRecursive`, and `ToggleFoldAll` decide fold/unfold from
  existing state. `FoldSelectedRanges` creates folds for selected ranges, and
  `FoldAtLevel_8`/`FoldAtLevel_9` extend the existing depth operations. See
  [crates/editor/src/fold.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/fold.rs#L96) and its level/selected-range methods.
- `SaveLocation` pushes the newest caret to navigation history. `ToggleFocus`
  activates the most recently active Editor item, including when invoked from the
  outline. `ToggleLineNumbers` toggles gutter presentation. See
  [crates/editor/src/navigation.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/navigation.rs#L945),
  [crates/editor/src/editor.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/editor.rs#L8811), and
  [crates/editor/src/config.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/config.rs#L74).

## Existing Fregat and Editor work

Editor source below was verified in `/work/projects/Editor/packages/` before Plan 207.
Implement it in Fregat `editor/packages/` after that cutover; the external checkout is
read-only for this wave.

[packages/editor/src/editor/foldOperations.ts](/work/projects/Editor/packages/editor/src/editor/foldOperations.ts) supports fold/unfold/toggle and
nesting operations. [packages/editor/src/editor/commandCatalog.ts](/work/projects/Editor/packages/editor/src/editor/commandCatalog.ts) declares
fold levels 1–7, fold/unfold all, recursive folds, and manual ranges.
[packages/editor/src/editor/scroll.ts](/work/projects/Editor/packages/editor/src/editor/scroll.ts) owns the viewport. Fregat's
[history-navigation.ts](../apps/web/src/features/editor/utils/history-navigation.ts)
owns host navigation. Extend these owners with the missing commands.

## Design

Use the [keymap architecture](../docs/keymap/architecture.md): command IDs, titles,
typed arguments, and mutation policy belong in the command table. Bindings belong in
Plan 206 preset data under `apps/web/src/keymap/presets/`. Hosted editors register
focus nodes and handlers in the window dispatcher. Preserve Linux/macOS contexts,
payloads, source order, and unbinds from the translation; activate modal rows when
their mode owner exists. A declined command falls through to its ancestor.

Expose view commands in `editor/packages/editor/`. Use the existing wrap/fold/display
mapping for scroll and caret clipping; keep saved locations in the existing navigation
owner. Fregat handles focus return through its workspace focus service. Fold levels
8 and 9 use the same depth helper as levels 1–7. Editor view state remains independent
for two views sharing a document.

Register a line-number setting if the existing registry cannot express the toggle,
with its consumer and `settings:reference` output. Publish Editor/multiline and widget
contexts for fold/viewport actions. Modal-only rows become active when their mode
exists; the command implementations can be verified before that work.

## Steps

- [ ] Add failing fixtures for missing depth/toggle operations and viewport caret-margin behavior.
- [ ] Add line/page scrolling and top/center/bottom placement to the existing viewport owner.
- [ ] Extend fold handlers for levels 8/9, selected ranges, and state-driven toggles.
- [ ] Wire saved locations, return-to-editor focus, and the registry-backed line-number toggle.
- [ ] Translate all supported preset rows and add `editor-viewport-and-fold-commands`.
- [ ] Read screenshots, verify two shared-document views, and ship the change.

## Acceptance

Run focused foldOperations, navigation, and viewport browser tests. Check nested
fold depths 8/9, mixed fold state, manual/reversed ranges, EOF, short buffers, wraps,
and view-local state. Scrolling keeps in-margin selections and matches Zed's clamp
outside the margin; centering never moves them. In `agent:browser scenario editor-viewport-and-fold-commands`, scroll a tall wrapped fixture, center its caret,
toggle recursive/all folds, toggle line numbers, save a location, and return focus
from another tool. Assert offsets/history and read screenshots back.

Run the narrow tests for changed owners and `bun run gates`; pre-commit typecheck
must pass. Browser scenarios use fixture/mock providers only. Put heavy tests,
scenarios, builds, and deploys through
`bash /work/tmp/wave-heavy/run.sh "zt-07" -- env PATH="$PATH" <command>`.
Use an explicit free port for any private dev server and stop it afterward.
Deploy verified implementation with `bun run install-release`, or
`bun run install-release --server --restart` when server code changes. Confirm the served release.

## Out of scope

A new viewport renderer, pane layout changes, outline construction, Vim/Helix
engines, and performance claims without before/after evidence.
