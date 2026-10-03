# Plan 265: Tabular file previews

## Status and authorization

Status: APPROVED 2026-09-29. Requested by the owner: "implement everything Zed has". Size: L. Depends on Plan 206, Plan 237. Approved work scheduled later, after these dependencies.

Triage assignment: ZT-46 in `/work/reports/keymap-wave/zed-feature-triage.json`; binding contexts and payloads in `/work/reports/keymap-wave/206-zed-translation.json`. Zed behavior below is pinned to `933d8d93`.

## Outcome

Inspect CSV, TSV, SSV, PSV, JSONL and NDJSON as a table in the current pane or beside the live source, including sorting, filtering and reading full cell values.

## Zed actions and behavior

- `tabular_data::OpenPreview` reuses or opens a preview in the active pane. `tabular_data::OpenPreviewToTheSide` places it in an adjacent pane and preserves source focus. Source edits trigger reparsing. [crates/tabular_data_preview/src/tabular_data_preview.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/tabular_data_preview/src/tabular_data_preview.rs#L107).

- The binding predicate includes csv/tsv/ssv/psv/jsonl/ndjson. The parser uses comma, tab, semicolon or pipe delimiters and a JSON-lines path; table state supports sorting/filtering by column. [crates/tabular_data_preview/src/parser.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/tabular_data_preview/src/parser.rs#L25), [crates/tabular_data_preview/src/table_data_engine/sorting_by_column.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/tabular_data_preview/src/table_data_engine/sorting_by_column.rs) and [crates/tabular_data_preview/src/table_data_engine/filtering_by_column.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/tabular_data_preview/src/table_data_engine/filtering_by_column.rs). This extends the triage outcome's CSV/TSV shorthand to its actual bound formats.

## Existing Fregat and Editor support

Text preview queries/components exist in [apps/web/src/lib/file-preview/utils/preview-query.ts](../apps/web/src/lib/file-preview/utils/preview-query.ts) and [apps/web/src/lib/file-preview/components/text-preview.tsx](../apps/web/src/lib/file-preview/components/text-preview.tsx). Document text ownership is in [apps/web/src/lib/documents/utils/types.ts](../apps/web/src/lib/documents/utils/types.ts). [packages/ui/src/patterns/virtual-list.tsx](../packages/ui/src/patterns/virtual-list.tsx) supplies shared row virtualization. Since this plan's original inspection, [156](156-documents-in-the-editor.md) delivered CSV
ownership in [csv-table.tsx](../apps/web/src/features/workbench/components/csv-table.tsx),
[csv-engine.ts](../apps/web/src/features/workbench/utils/csv-engine.ts) and
[csv-file-body.tsx](../apps/web/src/features/workbench/components/csv-file-body.tsx).
Reuse their document identity, parsing and presentation; [327](327-virtualization-and-two-axis-tables.md)
owns required two-axis table geometry.

The source snapshot/anchor APIs already exist in `editor/packages/editor/src/documentSession.ts` after Plan 207, verified in [the current Editor source](../editor/packages/editor/src/documentSession.ts).

## Design

Commands join [apps/web/src/keymap/table.ts](../apps/web/src/keymap/table.ts) with typed arguments and availability, following [the keymap architecture](../docs/keymap/architecture.md). Linux/macOS bindings are preset data under `apps/web/src/keymap/presets/` per Plan 206, retaining source contexts and payloads. The host dispatcher owns keys; handlers decline when their owner is unavailable. Extend the delivered CSV/tabular owner with source-linked identity and Plan 237 placement; preserve 156 ownership and coordinate geometry with 327. Query parsing by document key/revision/format and reject stale parses. Parse large data off the UI thread with cancellable, bounded work; registry entries own byte/row limits and reparse policy. Model columns/rows/cell source locations and diagnostics, preserving original text. Define delimited headers and heterogeneous JSON object column union; expose sorting/filtering as view state. Use 327's required two-axis table virtualization, accessible headers and native titles or a focused full-cell view for truncated values. Keep the prior complete subject during reparse, with header pending state. Preview operations do not modify the source.

## Steps

- [ ] Reconcile existing CSV fixtures and add missing parser fixtures for all six extensions and `tabular-file-preview` for both placements.
- [ ] Implement quoted delimiters, escaped quotes, embedded newlines, CRLF, empty/missing fields and heterogeneous JSON lines with row/column diagnostics.
- [ ] Add bounded parsing and cancellation keyed to the live unsaved buffer revision; register limits and generate settings reference.
- [ ] Compose virtualized rows, full-cell recovery, sorting/filtering and source-linked placement; retain source focus for side opening.
- [ ] Register both command/preset translations with the full extension predicate and add scenario selectors.

## Acceptance

Run only the new parser/model suites for malformed input, unequal row widths, limits, cancellation, JSON column union and stable source locations after sort/filter. `agent:browser scenario tabular-file-preview` opens all formats, changes unsaved source, sorts/filters and reads a long cell; assert both placements and stale-response rejection, then read `look` evidence. Any performance claim needs `trace --compare` and before/after render counts. Run `bun run gates` and the required typecheck. Heavy checks use the current wrapper in [AGENTS.md](../AGENTS.md#dev-gates-verification). Browser evidence uses fixture providers, an isolated home and explicit free ports; read screenshots back and record `/work/tmp/fregat-evidence/<run>/`. Commit by path, push, and deploy the implementation to the mesh after review; server changes require dev verification and `bun run deploy --server --restart`.

## Out of scope

Spreadsheet formulas, table editing/writeback, database connections and charting are outside this plan. XLSX is outside the pinned binding predicate.
