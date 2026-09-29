# E033: Full-document text reads are an explicit boundary

Implemented 2026-09-23 in Editor `10b0ac4`, with Platform `312f4419` and `c2af88b4`. Reading
state, delivering a plugin update, rendering and applying an edit no longer flatten the document.
A caller that needs the whole text asks for it by name.

Contracts:

- `TextReadSnapshot` (length, lines, `readRange`, chunks) is exported from the document,
  extensions and root entries. `TextSnapshot` adds `materializeFullText`.
- View snapshots carry a read source and `lineStartsView`, with no `fullText`.
  `serializeEditorViewSnapshot` is the named whole-view export.
- Inline replacement, injected-row and selection-range contexts carry `textSnapshot`, not `text`.
  Contributions receive `EditorContributionChange` and can recover every edit since a sync point
  through `getDocumentSyncPoint` / `changesSinceDocumentSyncPoint`.
- `defineLazyFullTextProperty`, the private `text` getters and `legacyEditTextSnapshot` are gone.

Tab-size inference, snippets, ghost text, selection expansion and `syncTextEdit` read bounded
ranges. Merge-conflict parsing scans chunks by index and carries regions across edits that touch no
marker line.

Enforcement: `bun run check:full-text` runs first in `health`. Each remaining whole-text read is a
named function in [full-text-boundary-allow.json](../../scripts/full-text-boundary-allow.json) with
its reason: view serialization, Shiki's open payload, LSP didOpen/didSave and full-sync recovery,
the live diff, `useFullText` and save serialization. On 2026-09-25
[E055](e055-edit-commands-read-lines.md) removed the edit-command entry, `commandDocumentText`.
`test/fullTextBoundary.test.ts` reads the same number of units at 64K and 1M.

Measured on two views over a fragmented document, median p95 input-to-applied, control → E033:

| Configuration | Size | Typing          | Undo             |
| ------------- | ---- | --------------- | ---------------- |
| plain         | 48M  | 1.05 → 0.90 ms  | 0.85 → 1.05 ms   |
| contributions | 4M   | 13.00 → 1.85 ms | 13.75 → 1.60 ms  |
| contributions | 48M  | 89.65 → 1.55 ms | 114.65 → 1.60 ms |

At 48M with contributions, the open heap went from 194 to 98 MiB and open time from 244 to 46 ms.
Retained heap after disposal matched control. The workload is
`examples/stress/boundary.mjs`; see the [stress README](../../examples/stress/README.md).
