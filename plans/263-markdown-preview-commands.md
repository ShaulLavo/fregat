# Plan 263: Complete Markdown preview commands

## Status and authorization

Status: APPROVED 2026-09-29. Requested by the owner: "implement everything Zed has". Size: M. Depends on Plan 207, Plan 204, Plan 206, Plan 237.

Triage assignment: ZT-44 in `/work/reports/keymap-wave/zed-feature-triage.json`; binding contexts and payloads in `/work/reports/keymap-wave/206-zed-translation.json`. Zed behavior below is pinned to `933d8d93`.

## Outcome

Open rendered Markdown in the current pane or beside source, scroll by small steps, rendered items or pages, copy rendered selection, and close the preview to return to its source.

## Zed actions and behavior

- `markdown::OpenPreview` reuses or adds a preview in the current pane. `markdown::OpenPreviewToTheSide` uses an adjacent pane and preserves source focus. `markdown::CloseAndReturnToEditor` activates the source, reopens it if its tab closed, and closes the preview. [crates/markdown_preview/src/markdown_preview_view.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/markdown_preview/src/markdown_preview_view.rs#L193) and [crates/markdown_preview/src/markdown_preview_view.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/markdown_preview/src/markdown_preview_view.rs#L1006).

- `markdown::ScrollUp` and `markdown::ScrollDown` use a small step capped at twice the rem size when an item is measurable. `markdown::ScrollUpByItem` and `markdown::ScrollDownByItem` use the top rendered item height. `markdown::ScrollPageUp` and `markdown::ScrollPageDown` use viewport height. `markdown::ScrollToTop` and `markdown::ScrollToBottom` reach list edges. [crates/markdown_preview/src/markdown_preview_view.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/markdown_preview/src/markdown_preview_view.rs#L892).

- `markdown::Copy` copies the selected rendered text when the selection is nonempty. [crates/markdown/src/markdown.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/markdown/src/markdown.rs#L1133).

## Existing Fregat and Editor support

[apps/web/src/features/workbench/components/markdown-preview-pane.tsx](../apps/web/src/features/workbench/components/markdown-preview-pane.tsx) renders the live buffer and synchronizes source lines through [apps/web/src/features/workbench/utils/markdown-scroll-positions.ts](../apps/web/src/features/workbench/utils/markdown-scroll-positions.ts). [apps/web/src/lib/markdown-mode/state/overrides.ts](../apps/web/src/lib/markdown-mode/state/overrides.ts) stores per-document view choices. Editor inline Markdown preview exists in `editor/packages/markdown/src/index.ts` after Plan 207, verified in [the current Editor source](../editor/packages/markdown/src/index.ts). The rendered split pane currently lacks this complete command set and a reusable current-pane preview identity.

## Design

Commands join [apps/web/src/keymap/table.ts](../apps/web/src/keymap/table.ts) with typed arguments and availability, following [the keymap architecture](../docs/keymap/architecture.md). Linux/macOS bindings are preset data under `apps/web/src/keymap/presets/` per Plan 206, retaining source contexts and payloads. The host dispatcher owns keys; handlers decline when their owner is unavailable. Register `MarkdownPreview` and nested `Markdown` focus nodes; opening commands resolve from `Editor && extension == md`. Preview identity includes the source document and placement under Plan 237 splits. Reuse the document buffer and source anchors. Preserve source selection while scrolling; scroll sync may reveal source lines without moving its caret. Add measurement-based scroll helpers with bounded small steps and actual top-item heights. Copy uses the browser selection inside the focused rendered owner through the existing clipboard mutation contract. Reusable Editor work belongs in `editor/packages/markdown`, while workbench placement/close/focus belongs in Fregat. The regular Markdown editing pack stays off.

## Steps

- [ ] Extend the existing Markdown preview tests with failing keyboard/placement cases; add `markdown-preview-commands` before changing handlers.
- [ ] Add source-linked current-pane/side preview records and close-return handling, including a closed source tab.
- [ ] Implement the eight scroll actions over rendered geometry; connect selection-only copy and focus contexts.
- [ ] Register all twelve commands and pinned preset rows; preserve source focus for side opening and avoid duplicate previews.
- [ ] Add selectors and verify headings, lists, code fences and images with source sync and preview focus.

## Acceptance

Run the existing focused suites in `apps/web/src/features/workbench/utils/tests/markdown-preview.test.ts` and `apps/web/src/features/workbench/components/tests/markdown-preview.test.tsx`, extended for scroll geometry, source restoration and selection copy. `agent:browser scenario markdown-preview-commands` checks both placements, all scroll groups, copy, close/return and reopening a closed source tab; assert the source caret remains stable and read `look` evidence. Run `bun run gates` and the required typecheck. Heavy checks use `bash /work/tmp/wave-heavy/run.sh "<label>" -- env PATH="$PATH" <cmd>`. Browser evidence uses fixture providers, an isolated home and explicit free ports; read screenshots back and record `/work/tmp/fregat-evidence/<run>/`. Commit by path, push, and deploy the implementation to the mesh after review; server changes require dev verification and `bun run install-release --server --restart`.

## Out of scope

Markdown authoring shortcuts, rich editing and parser changes are outside this plan. Split ownership is Plan 237.
