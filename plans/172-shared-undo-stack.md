# Plan 172: One shared undo/redo stack

## Status and authorization

- Status: RESEARCH — owner direction set, research not started. Nothing here authorizes
  implementation.
- Priority: P2.
- Planned at: Platform `9f343825`, 2026-09-25. Origin: Plan 126
  [LIFE-13](126-t3code-alignment/lifecycle.md) owner correction.

## Outcome

One undo/redo stack, extracted once and reused: Mod+Z steps back through recent actions and redo
steps forward again. LIFE-13 (settle, snooze, archive, unpin) is its first consumer. New
undo features use it.

## What exists today

- **Server file-tree journal.** `apps/server/src/fs/workspace-edit-journal.ts`: server-owned,
  persisted per drive, undo and redo, 24 h TTL for stable entries (Plan 136). The client reaches it
  through `features/editor/state/workspace-edit-service.ts` and `fileTree.undo` in
  `keymap/workspace-commands.ts`. Editor buffers keep a barrier at a workspace edit.
- **Editor undo graph.** Plan 121: a graph per buffer in `@singapore-editor/editor`, persisted to
  IndexedDB for closed files.
- **Snooze Undo.** `features/chat-mode/hooks/use-session-actions.ts`: a toast action that
  dispatches `unsnooze`. No redo, no key.
- **Composer.** Lexical's `HistoryPlugin` (goes with [Plan 171](171-composer-on-our-editor.md)).
- **Lane L5's LIFE-13.** First step in PR #38, reverted from `main` in `5786feb1`, now on PR #41
  (`review-again/L5`). It adds `packages/client-core/src/history/undo-stack.ts` (a pure
  undo/redo pair with a 50-entry limit), `chat-mode/state/session-undo.ts`,
  `use-session-undo-shortcut.ts` and `keymap/state/undo-barrier.ts`.
- Mod+Z is bound per pane: `client-core/src/commands/workspace.ts` binds it to the file tree
  with `yieldsToTextEntry`.

## Research questions

1. Survey the implementations above: entry shape, inverse capture, redo, limits, expiry,
   persistence, and failure when the inverse no longer applies.
2. The shared shape. Is L5's `undo-stack.ts` the core, and what does it lack?
3. Ownership: which stacks live in the client, which on the server (the journal must stay
   server-owned), and whether one client stack can front a server one.
4. Redo and persistence per consumer: does rail undo survive a reload or another device?
5. How Mod+Z picks the owning surface: focus target first (editor, composer, terminal, tree),
   then the app-level stack; what happens when the focused surface has nothing to undo.

Deliverable: the shared shape, the Mod+Z routing rule, and the executable plan for LIFE-13 on it.
