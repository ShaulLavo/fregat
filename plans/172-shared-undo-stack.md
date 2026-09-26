# Plan 172: One shared undo/redo stack

## Status and authorization

- Status: RESEARCH DONE (2026-09-25) — findings, recommendations and proposed phases below;
  owner questions answered 2026-09-26. Nothing here authorizes implementation.
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

## Research findings (2026-09-25)

Read from Platform `origin/main` at `2a0d37ac` (the plan exists only there), lane L5 from
`origin/review-again/L5` (PR #41, draft), Editor `origin/main` at `e2fd299`, T3 Code at `7a12aff4`,
VS Code at `c1c5b32e`.

Two corrections to "What exists today". Snooze Undo is in `use-session-actions.ts:74–87`;
`session-rail-store.ts` has no undo. `keymap/state/undo-barrier.ts` is already on `main` (the
editor's workspace-edit barrier toast); L5 did not add it. L5's branch is also past the
"latest slot" step: it already has a 50-step stack with redo, server receipts and a restore command.

### Q1. Survey

|                                         | Entry and inverse                                                                                                                                                                                                                                                                                                         | Redo                                                                           | Limit, expiry                                                                                                                                             | Persistence                                                                                                                                           | When the inverse no longer applies                                                                                                                                                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **File-tree ops** (Plan 136)            | Server manifest: staged legs plus guards (`workspace-edit-journal.ts:186–219`); inverse is a reverse program over the journal                                                                                                                                                                                             | Yes; a new forward op clears the category's redo (`workspace-edit.ts:676–697`) | No count cap. 512 MiB journal, 128 MiB per op (`workspace-edit-journal.ts:32–33`); 24 h after last touch (`:34`, reaped at `workspace-edit.ts:2389–2401`) | Server, per drive, survives restart (`:2499–2507`); every window reads one list (`:367–386`)                                                          | Guards re-checked before reversal (`:780–808`); only the head may reverse (`WORKSPACE_EDIT_NOT_HEAD`, `:741–757`); a later content edit evicts the ops it touches (`:3132–3148`). The client names the stale entry (`features/workspace/state/file-operations.ts:283–316`) |
| **Workspace edits** (multi-file, agent) | Client `WorkspaceEditGroup` holding live buffer receipts plus the server result (`workspace-edit-service.ts:1330–1337`)                                                                                                                                                                                                   | Yes; mutable `undoStack`/`redoStack` arrays (`:400–404`)                       | 20 groups (`:100`, evicts oldest at `:1338–1341`)                                                                                                         | Memory only. Cleared when the server epoch changes (`:431–441`); receipts tie it to open buffers                                                      | Local reverse fails → `workspace-edit-stale`, the group and every group overlapping its paths are dropped (`:1485–1497`, `:1553–1570`); a partial reversal goes to recovery                                                                                                |
| **Editor graph** (Plan 121)             | Snapshot per node, not an inverse; a tree with a preferred child per node (`Editor packages/editor/src/history.ts:9–27`)                                                                                                                                                                                                  | Yes, follows the most recently used branch (`:231–238`)                        | 200 retained states, a setting (`history.ts:60`, `editor.history.retainedStates`)                                                                         | IndexedDB for closed files, keyed by content hash; 30 days and a 64 Mi code-unit budget (`settings/keys.ts:450–480`, `history-persistence.ts:32–110`) | Cannot fail inside the buffer. Stops at a workspace-edit barrier and says so (`keymap/state/undo-barrier.ts:13–26`). Stored history is dropped on a hash mismatch                                                                                                          |
| **Snooze Undo** (`main`)                | None recorded; the toast fires an unconditional `unsnooze`                                                                                                                                                                                                                                                                | No                                                                             | Toast lifetime                                                                                                                                            | None                                                                                                                                                  | Overwrites a concurrent change. L5 kept a failing control for it: another client's new wake time comes back `null` (`plans/126-t3code-alignment/lifecycle-undo-delivery.md` on L5)                                                                                         |
| **L5 LIFE-13** (PR #41)                 | `{ref, before, restoreCommandId, expectedRevision, restoreRevision}` per row; batches per action (`client-core/src/chat/rail/lifecycle-undo.ts:21–32`). The server keeps `before` in the durable command receipt and restores from it, never from the client (`apps/server/src/orchestration/lifecycle-restore.ts:44–98`) | Yes; the inverse is the restore's own receipt                                  | 50 batches (`history/undo-stack.ts:11`); the notice lasts 5 s, the stack stays                                                                            | Memory, per window (module store, `features/chat-mode/state/session-undo.ts:28–31`)                                                                   | `LIFECYCLE_CONFLICT` on revision mismatch; that row is forgotten in both directions and the other rows proceed. Successful rows rebase the neighbouring entry's revision (`lifecycle-undo.ts:82–104`, `:124–144`)                                                          |
| **Composer**                            | Lexical `HistoryPlugin` (`features/chat/components/chat-input-editor.tsx:4`)                                                                                                                                                                                                                                              | Yes                                                                            | Lexical default                                                                                                                                           | None                                                                                                                                                  | Its own                                                                                                                                                                                                                                                                    |
| T3 Code (upstream)                      | Closure per action; one notice, consecutive same-kind actions grouped (`apps/web/src/hooks/showThreadUndoNotice.ts:28–80`)                                                                                                                                                                                                | No                                                                             | Notice lifetime                                                                                                                                           | None                                                                                                                                                  | Claim tokens expire an older undo of the same kind (`threadUndo.ts:16–38`)                                                                                                                                                                                                 |

Every server-backed undo already follows one rule: the server computes the inverse from something
durable it recorded (journal stage, command receipt) and applies it only under an optimistic check
(path guards, `lifecycleRevision`). The client never supplies the prior state. New server-backed
undo keeps to that rule; this is the part the file journal and L5 share, not code.

### Q2. The shared shape

**Recommendation: L5's `packages/client-core/src/history/undo-stack.ts` becomes the core**, together
with the stateful half of `createSessionLifecycleHistory` (`lifecycle-undo.ts:73–146`), which is not
lifecycle-specific. The core as it stands lacks four things:

1. **Dropped entries are silent.** `pushUndo` slices off the oldest entry and clears redo without
   returning either (`undo-stack.ts:8–14`). The workspace-edit service has to release both
   (`workspace-edit-service.ts:1338–1347`), so `pushUndo` returns `{ stack, dropped }`.
2. **No retain.** `forget` and `rebase` in `lifecycle-undo.ts:82–104` and the path invalidation in
   `workspace-edit-service.ts:1343–1370` and `:1553–1570` each rewrite both lists by hand. One
   `retainHistory(stack, keep: (entry) => entry | null)` covers all three.
3. **The controller is inside the lifecycle adapter.** `subscribe`/`getSnapshot` (which fits
   `useSyncExternalStore` and a zustand mirror), `record`, `clear`, and `step` with the branch
   counter that drops a stale finish (`:124–144`) move to `client-core/src/history/undo-history.ts`.
   The lifecycle file keeps receipts, restore commands and verbs.
4. **Batches are the adapter's concern.** The generic `step(direction, apply)` takes one entry and
   `apply` returns its inverse or `null`. The lifecycle adapter's `apply` loops the batch rows,
   calls `retain` for forget and rebase, and returns the batch of applied rows. That keeps L5's
   partial-failure behaviour unchanged.

```ts
// client-core/src/history/undo-stack.ts: pure, oldest entry first
type UndoStack<E> = Readonly<Record<'undo' | 'redo', readonly E[]>>
pushUndo<E>(stack: UndoStack<E>, entry: E, limit: number): { stack: UndoStack<E>; dropped: readonly E[] }
takeHistory<E>(stack, direction): { entry: E | undefined; stack: UndoStack<E> }
finishHistory<E>(stack, direction, inverse: E): UndoStack<E>
retainHistory<E>(stack, keep: (entry: E) => E | null): { stack: UndoStack<E>; dropped: readonly E[] }

// client-core/src/history/undo-history.ts: stateful, no React
createUndoHistory<E>(options: { limit: number; onDrop?: (entries: readonly E[]) => void }): {
  getSnapshot(): UndoStack<E>; subscribe(listener: () => void): () => void
  record(entry: E): void; retain(keep: (entry: E) => E | null): void; clear(): void
  step(direction, apply: (entry: E) => Promise<E | null>): Promise<E | null>
}
```

The history does not serialize steps. Its hosts run each step as a TanStack mutation with a
`scope`, as L5 does (`session-undo.ts:76–91`) and the file tree does (`file-operations.ts:128–160`).
The limit stays a constant (50), not a setting: nothing a user tunes depends on it.

What does **not** become this core:

- **The Editor graph.** It stores snapshots, branches, and serializes to IndexedDB; a linear
  stack of inverses is a strict subset. It stays in `@singapore-editor/editor`.
- **The file-operation history.** Its stack is the server's list, read through
  `fileOperationHistoryQuery` with `staleTime: 0` (`file-operations.ts:50–62`). Mirroring it in a
  client stack would put a second copy of server state beside TanStack.
- **The server journal.** A crash-safe filesystem transaction log. Nothing in it generalizes past
  the receipt-plus-check rule above.

### Q3. Ownership

| Stack                | Owner                                               | Why                                                                                          |
| -------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| File-tree operations | Server (journal)                                    | Disk state; several windows share one head; survives restart                                 |
| Workspace edits      | Client (`WorkspaceEditService`) over server results | Entries hold live buffer receipts that cannot leave the window                               |
| Session lifecycle    | Client stack of server receipts                     | The server owns the prior state and the conflict check; the client owns ordering and the key |
| Editor text          | Editor buffer                                       | Per-document graph                                                                           |
| Composer, inputs     | The element                                         | Native or Lexical                                                                            |

Can one client stack front a server one? It already does, and without a client copy: the file tree
reads the server list as a query and reverses its head through a scoped mutation. Session undo is the
other form, where the client keeps receipt ids and the server decides. Both work because the server
refuses a stale inverse. No client stack needs to proxy the journal.

### Q4. Redo and persistence per consumer

- File-tree: redo yes; survives reload and restart for 24 h, on every device that talks to that
  server.
- Workspace edits: redo yes; lost on reload and on server restart.
- Editor: redo and branches; closed-file history survives reload in this browser only.
- Session lifecycle (L5): redo yes; **lost on reload**, per window. Receipts are durable
  (`orchestration_command_receipts`, no pruning found in `command-receipts.ts`), so keeping
  `{restoreCommandId, expectedRevision}` in IndexedDB would make undo survive a reload with no
  server change. Another device would need a server-held per-client stack, which is new. The
  revision check makes either one safe. **Recommendation:** memory only, as upstream does and L5
  does; see owner question 2.

### Q5. How Mod+Z picks the owning surface

Two facts about the keymap decide the rule:

- A binding whose `when` fails is skipped and the **next candidate for the same chord runs**
  (`Editor packages/editor/src/keymap/runtime.ts:89–99`, fed by `keymap-session.ts:145–155`).
  Candidates are pane-specific first, then pane-less (`active-bindings.ts:260–272`). A pane-less
  app Mod+Z would therefore run in the file tree whenever `fileOperationUndoable` is false.
- `yieldsToTextEntry` keeps a chord off any input, textarea, select or contenteditable
  (`keymap-session.ts:136–138`, `utils/keyboard-event.ts:13–34`). That covers the Lexical composer,
  search boxes and Ghostty's textarea. The terminal also claims app chords before Ghostty encodes
  them (`features/terminal/hooks/use-keybindings.ts:7–12`), so an app Mod+Z bound in the terminal
  pane would take Ctrl+Z (SIGTSTP) from the shell.

**Recommendation: the routing rule.**

1. Text entry has focus → its own undo. No app binding claims the key.
2. The focused pane owns an undo → that pane's command, even when it has nothing to undo. Editor →
   Editor graph (the barrier toast explains an empty stop); file tree → `fileTree.undo`; terminal →
   the PTY. **Nothing falls through to the app history.** Otherwise holding Ctrl+Z in the editor
   would start unarchiving sessions once the text history runs out.
3. Any other pane → the app history (`workspace.undoSessionAction` today). If it is empty, nothing
   claims the key.

Mechanism: declare the owning panes once in `client-core/src/commands/`
(`editor`, `file-tree`, `terminal`, `dialog`, `command-palette`) and bind app undo and redo to
every other `FocusArea`, never pane-less. L5 hand-lists `global, git, logs, problems, search,
settings` (L5 `packages/client-core/src/commands/workspace.ts`), so a new pane gets no app undo
until someone edits the list; deriving the list from the declared set fixes that. L5 also leaves
out `chat`. Because rule 1 already protects the composer, **Recommendation:** include `chat`, so
Mod+Z works with focus on the transcript. L5's `keymap.test.ts` case becomes a check over every
`FocusArea`.

This matches VS Code's shape. Its `UndoCommand` is a `MultiCommand` whose implementations are
tried by priority, each claiming only when its view has focus
(`src/vs/editor/browser/editorExtensions.ts:204–251`; explorer at
`src/vs/workbench/contrib/files/browser/files.contribution.ts:653–679`), with the DOM
`execCommand('undo')` last (`src/vs/editor/browser/coreCommands.ts:2095–2102`). Platform gets the
same order from pane-scoped bindings, with no second dispatch mechanism.

### Owner questions

1. **Does Mod+Z still undo after the 5 s notice has gone?** LIFE-13's acceptance says no
   (upstream); your stack correction and L5 say yes, until 50 steps. Options: (a) the stack stays
   live; (b) entries expire with the notice. **Recommendation: (a)**, and update the LIFE-13
   acceptance line.
   Decided 2026-09-26: owner — (b): Mod+Z does not act once the 5 s notice is gone, matching LIFE-13's acceptance and upstream.
2. **Should rail undo survive a reload?** Options: (a) memory, per window; (b) IndexedDB, per
   browser; (c) on the server, across devices. **Recommendation: (a).** (b) can be added later
   without a server change.
   Decided 2026-09-26: owner — (a) memory only now; surviving a reload is a low-priority nice-to-have.
3. **One app timeline or one per domain, once a second app-level consumer exists** (for example
   workspace edits, which have no key today)? Options: (a) one history instance holding a tagged
   union, where Mod+Z steps back through whatever happened last; (b) a history per domain, each
   with its own command. **Recommendation: (a)**, matching "steps back through recent actions".
   LIFE-13 ships with one domain either way, and the API above supports both.
   Decided 2026-09-26: owner — (b) one stack per domain, no merged app timeline; this overrides the recommendation.

### Proposed phases

1. **Extract the core on L5's branch before PR #41 lands.** Add `dropped` and `retainHistory` to
   `undo-stack.ts`; move the controller to `history/undo-history.ts`; make `lifecycle-undo.ts` an
   adapter; move the stack tests to `client-core/src/history/tests/`. Delete the unused
   `resetSessionUndo`. Web and TUI both keep their current behaviour.
2. **Routing.** Add the owning-pane set and derive app undo and redo bindings from it; include `chat`
   per the Q5 recommendation; pin every `FocusArea` in
   `keymap.test.ts`.
3. **Land LIFE-13** on the core: L5's receipts, `session.lifecycle.restore`, migration and UI
   unchanged, with the acceptance amended per owner question 1. Re-run
   `scripts/agent/scenarios/session-undo.ts` and the editor, file-tree and search-input undo
   scenarios.
4. **Optional: workspace edits on the core.** Replace the two arrays in `WorkspaceEditService`
   with the pure operations (`onDrop` → `releaseGroup`, invalidation → `retainHistory`), leaving
   the reverse logic untouched.
