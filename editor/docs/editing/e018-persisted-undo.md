# E018: Persisted undo history

Implemented 2026-09-20 in Editor `2e2ded1` and Platform `2acc3b73` and `0bb995a1`. Closing a file
keeps its undo graph; reopening the same content restores it, branches included.

Editor: `buffer.serializeHistory()` and `buffer.restoreHistory(data)` in
[historySerialization.ts](../../packages/editor/src/historySerialization.ts). A node stores its edit
script against its parent, never document text. Selections are offsets. Restoring refuses text of
another length or version, a buffer that already has history, and edits that do not fit the text.
[selections-and-undo.md](selections-and-undo.md) describes the format.

Platform owns storage and lifecycle in `apps/web/src/features/editor/state/history-persistence.ts`
and `history-store.ts`. It writes on save and on eviction, and restores when a new buffer's content
hash equals the stored `contentHash`. That is VS Code's rule; a changed file opens without history.
Settings `editor.history.persist`, `editor.history.persistDays` and `editor.history.persistBudget`
bound it. The scenario `editor-undo-reopen` proves it in the app.

Where it differs from the plan, by the owner's choice: IndexedDB only (no server file, no atomic
writer), the content hash stands in for the backing-file digest, and there is no dirty-buffer
recovery. Open follow-ups, none scheduled: a clear-all command, and recovering unsaved text.

Validation: `test/historySerialization.test.ts` restores undo, redo and a second branch over freshly
loaded text, keeps recording after a restore, and covers each refusal.
