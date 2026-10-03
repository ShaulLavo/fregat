# Plan 262: Notebook documents, cells and command/edit modes

## Status and authorization

Status: APPROVED 2026-09-29. Requested by the owner: "implement everything Zed has". Size: L. Depends on Plan 207, Plan 204, Plan 206, Plan 261, Plan 234. Approved work scheduled later, after these dependencies.

Triage assignment: ZT-43 in `/work/reports/keymap-wave/zed-feature-triage.json`; binding contexts and payloads in `/work/reports/keymap-wave/206-zed-translation.json`. Zed behavior below is pinned to `933d8d93`.

## Outcome

Open and save an .ipynb document, edit code and Markdown cells, reorder or delete cells, switch command/edit modes, navigate between cells, and run one, all or the next cell.

## Zed actions and behavior

- `notebook::AddCodeBlock`, `notebook::AddMarkdownBlock`, `notebook::DeleteCell`, `notebook::MoveCellUp` and `notebook::MoveCellDown` operate on stable cell identities and ordered cells. `notebook::EnterCommandMode` focuses the notebook; `notebook::EnterEditMode` focuses the selected cell editor. [crates/repl/src/notebook/notebook_ui.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/repl/src/notebook/notebook_ui.rs#L713).

- `notebook::Run` executes code or finishes Markdown editing. `notebook::RunAll` queues code cells in document order. `notebook::RunAndAdvance` selects the next cell in command mode, adding a code cell at the end. `notebook::NotebookMoveUp` and `notebook::NotebookMoveDown` move inside the cell until its first/last display row, then move to the neighboring cell. These two actions come from the supplemental modal inventory. [crates/repl/src/notebook/notebook_ui.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/repl/src/notebook/notebook_ui.rs#L654) and [crates/repl/src/notebook/notebook_ui.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/repl/src/notebook/notebook_ui.rs#L1526). The file model is [crates/repl/src/notebook.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/repl/src/notebook.rs).

## Existing Fregat and Editor support

The current document/tab/save unions are in [apps/web/src/lib/documents/utils/types.ts](../apps/web/src/lib/documents/utils/types.ts) and contain no notebook variant. Markdown rendering already exists in [packages/markdown/src/components/markdown.tsx](../packages/markdown/src/components/markdown.tsx). Cell text/history foundations are `editor/packages/editor/src/documentSession.ts` after Plan 207, verified in [the current Editor source](../editor/packages/editor/src/documentSession.ts), with view contributions in `editor/packages/editor/src/createPlugin.ts` after Plan 207, verified in [the current Editor source](../editor/packages/editor/src/createPlugin.ts). Reuse Plan 234 file lifecycle and Plan 261 kernel ownership.

## Design

Commands join [apps/web/src/keymap/table.ts](../apps/web/src/keymap/table.ts) with typed arguments and availability, following [the keymap architecture](../docs/keymap/architecture.md). Linux/macOS bindings are preset data under `apps/web/src/keymap/presets/` per Plan 206, retaining source contexts and payloads. The host dispatcher owns keys; handlers decline when their owner is unavailable. Introduce a notebook document owner with cell IDs/order, per-cell Editor documents, metadata, execution counts, outputs and notebook-level dirty/save state. Persist valid nbformat v4 and preserve raw cells/unknown metadata. Notebook structural operations enter document undo history. Contexts are `NotebookEditor`, `notebook_mode == command` and child `Editor` nodes; cell printable input stays native in edit mode. Put display-row boundary navigation and reusable cell editor work in `editor/packages/*` after Plan 207. The Fregat notebook feature owns file serialization, layout and kernel commands. Output updates carry cell IDs and execution generations so reordering cannot retarget results.

## Steps

- [ ] Create .ipynb fixtures with code, Markdown, raw cells and outputs; demonstrate a failing round-trip test and `notebook-cells` scenario.
- [ ] Extend document/save ownership and add cell serialization, structural undo and dirty tracking; preserve metadata and unsaved cell text.
- [ ] Compose cell editors and rendered Markdown; implement add/delete/reorder and stable focus after each operation.
- [ ] Register all twelve actions, modes and supplemental boundary navigation through the shared dispatcher; reuse Plan 261 execution.
- [ ] Add pending/error/empty output states, safe rich-output rendering, cell virtualization and scenario selectors.

## Acceptance

Focused document tests cover .ipynb round-trip, raw/unknown metadata, structural undo, edits before save, outputs after reorder/delete, and last-cell RunAndAdvance. Editor tests cover first/last display row with soft wraps and command/edit focus. `agent:browser scenario notebook-cells` adds and reorders cells, edits/saves/reopens, runs all against the fixture kernel, and verifies Markdown rendering and caret isolation; read `look` evidence. Run `bun run gates` and the required typecheck. Heavy checks use `bash /work/tmp/wave-heavy/run.sh "<label>" -- env PATH="$PATH" <cmd>`. Browser evidence uses fixture providers, an isolated home and explicit free ports; read screenshots back and record `/work/tmp/fregat-evidence/<run>/`. Commit by path, push, and deploy the implementation to the mesh after review; server changes require dev verification and `bun run install-release --server --restart`.

## Out of scope

Kernel protocol/lifecycle is Plan 261. Collaborative notebooks, notebook-specific debugging and automatic package installation are outside this plan.
