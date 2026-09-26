# Plan 178: keyboard and selection

- Status: PROPOSED. Size L. After [virtualization](virtualization.md).
- Owns: a shared selection model, multi-select in `useListbox`, and the tree's commands in the
  keymap.

## Outcome

The tree navigates through `useListbox` and selects through a shared selection model. Keys that are
commands (rename, delete, new file, refresh, undo) are keymap commands with web bindings. The
session rail moves onto the same selection model and gains keyboard ranges.

## Today

**The tree** handles its own keys and stops propagation for each (`useFileTreeKeyboard.ts:290-406`,
409 lines; `useFileTreeFocusSync.ts`, 410; `focusHelpers.ts`, 205; `stickyFocusMode.ts`). Arrows
move focus without selecting; Shift+Arrow ranges; Mod+Space toggles; Mod+A; F2; printable keys seed
the filter; Shift+F10; Enter and Space fall through to the native button click. Real DOM focus on a
roving row. Selection lives in the controller: anchor, `selectPathRange`,
`extendSelectionFromFocused`, `toggleFocusedSelection`, `selectAllVisiblePaths`
(`FileTreeController.ts:692-831`), and the click table (`rowClickPlan.ts:28-48`).

**`useListbox`** (`packages/ui/src/patterns/use-listbox.ts`, `listbox-keys.ts`): one tab stop with
`aria-activedescendant`; Left/Right collapse, parent, expand and child for `role: 'tree'`
(`listbox-keys.ts:42-47`); opt-in typeahead; returns `none` for any modifier (`:20`); the cursor is
the selection (`aria-selected` follows it, `:169-173`); keys typed into an input inside a row are
skipped (`ignoresListboxKey`, `:204-210`); `onActiveKeyDown` runs first for extras.

**Other selection:** the session rail keeps a zustand store (`session-multi-select-store.ts`) over
pure helpers `sessionClickIntent` and `sessionIdRange` (`packages/client-core/src/chat/rail/multi-select.ts`),
pointer-only, shown as `ListRow marked`. Git changes, search and the file picker are single-select.

**Keymap:** web binds only `fileTree.undo` / `redo` (Mod+Z, `pane: 'file-tree'`,
`yieldsToTextEntry`), `workspace.findInFileTree` (Mod+F) and `focusFileTree` (Mod+Shift+E).
`fileTree.newFile / newFolder / rename / delete / refresh` are TUI chords only; the web has no
Delete key.

## Work

1. **Selection model.** Lift the controller's selection logic and the click table into a pure
   `selection-model` in `packages/client-core` (or `packages/ui` if it stays UI-only): anchor,
   range, toggle, select all, click intent with Mod and Shift. The rail's `sessionClickIntent` merges
   into it. The controller keeps calling it, so the TUI keeps working.
2. **`useListbox` multi-select.** An optional `selection` input separates cursor from selection:
   `aria-multiselectable`, `aria-selected` from the set, Shift+Arrow / Shift+Home / Shift+End ranges,
   Mod+Space, Mod+A, click intents. Without it, lists behave as today.
3. **Printable keys.** An `onPrintableKey` hook replaces opt-in typeahead for lists with a filter:
   the tree seeds `FilterField` (letters and digits only, per quirk 3).
4. **Activation.** Enter and Space call the list's `onActivate`: select only this row, toggle a
   folder, open a file. Same outcome as today's native click.
5. **Focus model** (Q3): `aria-activedescendant` with one tab stop, the `useListbox` model. Real DOM
   focus only enters the rename and filter inputs. The cursor row is kept mounted by `keepMounted`,
   and the parked-row machinery is gone.
6. **Sticky hand-off.** Keyboard moves that start on a sticky row keep the sticky position
   (`stickyFocusMode.ts`); a sticky-row click reveals the real row below its sticky parents. Both
   move into the tree's `onActiveKeyDown` and row click on top of `useListbox`.
7. **Keymap commands.** F2 becomes `fileTree.rename` with a web binding (`pane: 'file-tree'`),
   gated on `mutationsEnabled` (quirk 1, fixed). Mod+A yields to text entry. No new bindings: the
   web keeps no Delete or refresh key (Q2), though the commands are one binding away.
8. **Rail.** The session rail moves onto the selection model and gains Shift+Arrow ranges. Its store
   keeps only what the model does not own.

## Parity

Parity spec "Keyboard", "Selection and focus", and the pointer lines for Mod-click, Shift-click,
sticky-row click. Quirks 2–5 stay as they are (Q2).

## Delete

`useFileTreeKeyboard.ts`, `useFileTreeFocusSync.ts` (focus half), `focusHelpers.ts`,
`utils/render/keyboard.ts`, `rowClickPlan.ts` (moved), the controller's selection methods (moved).
`stickyFocusMode.ts` shrinks to the sticky hand-off.

## Verification

- Every keyboard and pointer test from the harness.
- Screen reader check (Orca on Linux): the tree announces level, position, expanded state and
  selection count.
- The rail's `session-rail-drag.test.tsx` and `session-ordering` scenario, plus new range tests.
