# Plan 229: Add shared multibuffer excerpt ranges and source mapping

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Depends on Plan 207, Plan 204, Plan 206. Size: L. Triage item: ZT-10.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`. Zed behavior is pinned to
  `933d8d93819c749a607e561883855a9b95c79cea`.

## Outcome

Represent several source ranges in one editor while keeping every caret and edit attached to its source document.

## Covered Zed actions and behavior

`editor::ExpandExcerpts`; `editor::MoveToStartOfExcerpt`; `editor::MoveToStartOfNextExcerpt`; `editor::SelectToStartOfExcerpt`; `editor::SelectToStartOfNextExcerpt`.

- Zed `MultiBuffer` retains source buffer identities, excerpt IDs, context ranges,
  primary ranges, and anchors. Its snapshot maps rendered positions/ranges back to
  source buffers; shared source edits and history update all views. See
  [crates/multi_buffer/src/multi_buffer.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/multi_buffer/src/multi_buffer.rs#L74), `ExcerptRange`, and
  `range_to_buffer_ranges` in that file.
- `editor::MoveToStartOfExcerpt` moves to the current excerpt start, or the preceding
  excerpt when already at its start. `MoveToStartOfNextExcerpt` advances to the next
  excerpt boundary and clips at the end. Selection variants retain the anchor.
  See [crates/editor/src/movement.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/movement.rs#L676) and
  [crates/editor/src/navigation.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/navigation.rs#L725).
- `ExpandExcerpts` adds context lines around excerpts touched by the selections,
  preserving source anchors and merging context as the existing multi-buffer owner
  dictates. Its `lines` argument is typed even though the input uses the default.
  See [crates/editor/src/navigation.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/navigation.rs#L964) and `expand_excerpts_for_direction`.

## Existing Fregat and Editor work

Editor source below was verified in `/work/projects/Editor/packages/` before Plan 207.
Implement it in Fregat `editor/packages/` after that cutover; the external checkout is
read-only for this wave.

[packages/editor/src/documentSession.ts](/work/projects/Editor/packages/editor/src/documentSession.ts) provides shared source sessions,
anchored selections, edit transactions, and history. Editor diff views compose
existing source documents. Fregat's
[result-file-editor.tsx](../apps/web/src/features/search/components/result-file-editor.tsx)
uses static, windowed per-file projections and source-line gutters; it does not
provide editable cross-document excerpts. The document union is in
[types.ts](../apps/web/src/lib/documents/utils/types.ts). The excerpt model must retain
source identity instead of constructing another editable copy of projected text.

## Design

Use the [keymap architecture](../docs/keymap/architecture.md): command IDs, titles,
typed arguments, and mutation policy belong in the command table. Bindings belong in
Plan 206 preset data under `apps/web/src/keymap/presets/`. Hosted editors register
focus nodes and handlers in the window dispatcher. Preserve Linux/macOS contexts,
payloads, source order, and unbinds from the translation; activate modal rows when
their mode owner exists. A declined command falls through to its ancestor.

Build the reusable excerpt model in `editor/packages/editor/` and its textbuffer
mapping contracts. Define branded source-document, excerpt, source-offset, and
view-offset types. A snapshot carries its source revisions and resolves view spans
into source spans. Synthetic headers/separators are distinct noneditable segments.
Selections retain source anchors, orientation, and excerpt affinity when the same
source appears more than once.

Source DocumentSession owns text and dirty/history state. The excerpt owner projects
reads, syntax, diagnostics, folds, and selections; it routes edit intents back to
source transactions. Define atomic cross-source edits and coordinated undo/redo
through Editor prepared-transaction APIs and an excerpt history coordinator.
Original file views participate in the same history operation.
Reuse Fregat's workspace-edit coordinator at the host boundary where it applies. Reject
an invalid or stale member before applying any member. Expansion changes the
projection while preserving source selections and undo history. Define insertion,
deletion, paste, and selection behavior at every synthetic boundary in the model.

Publish `Editor && multibuffer` from the view owner. Fregat's document service adapts
existing source sessions; a fixture gallery demonstrates two files in one editor.
Search/reference/review consumer UI belongs to Plan 230. No separate text copies or
independent binding listeners enter those future consumers.

## Steps

- [ ] Build a failing two-source fixture proving missing mapping/edit propagation before adding the excerpt model.
- [ ] Define excerpt/snapshot/source-anchor contracts, immutable projection segments, and bidirectional range mapping.
- [ ] Integrate source session lifecycle, external edits, syntax/diagnostic mapping, and source disposal behavior.
- [ ] Implement atomic mapped edits and coordinated undo/redo across sources and their existing file views.
- [ ] Add movement/selection/expansion commands, contexts, and Plan 206 preset data.
- [ ] Add a `/dev` excerpt gallery and `multibuffer-excerpt-model` scenario; read screenshots and ship the package/web integration.

## Acceptance

Run focused mapping/transaction tests over two sources, repeated excerpts from one
source, overlap, empty ranges, CRLF, Unicode, and reversed cross-excerpt selections.
Check synthetic-boundary insertion/deletion/paste policy, source revisions, disposed
sources, and source edits during expansion. A cross-source edit and undo/redo must
update the original file views without partial mutation; editing one occurrence
updates every occurrence of that source.

In `agent:browser scenario multibuffer-excerpt-model`, open the fixture gallery,
move/select between excerpt starts, expand context, edit two sources, and undo/redo
from the excerpt view and a source view. Assert actual source text, dirty state,
anchors, and history before reading screenshots back. A projection swap preserves
the shown subject until its new snapshot is ready.

Run the narrow tests for changed owners and `bun run gates`; pre-commit typecheck
must pass. Browser scenarios use fixture/mock providers only. Put heavy tests,
scenarios, builds, and deploys through
host-local [heavy-runner](https://github.com/ShaulLavo/heavy-runner), configured in the local `fregat-local` skill.
Use an explicit free port for any private dev server and stop it afterward.
Deploy verified implementation with `bun run install-release`, or
`bun run install-release --server --restart` when server code changes. Confirm the served release.

## Out of scope

Search/reference/review consumer views and `OpenExcerpts`, `OpenExcerptsSplit`,
`OpenSelectionsInMultibuffer`, and `text_finder::Toggle` from Plan 230; notebooks,
collaboration, and a separate source-document persistence engine.
