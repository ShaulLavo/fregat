# Plan 171: The chat composer runs on our own editor

## Status and authorization

- Status: RESEARCH — owner direction set, research not started. Nothing here authorizes
  implementation.
- Priority: P2. The composer works today; this removes a second editor framework.
- Planned at: Platform `9f343825`, Editor `e2fd299`, 2026-09-25. Origin: Plan 126
  [INTERACTION-11](126-t3code-alignment/interaction.md) owner ruling.
- Depends on: [Plan 111](111-editor-decorations.md) (decorations, question 7) first.

## Outcome

Lexical is deleted from `apps/web`. The chat composer is one more host of `@singapore-editor/*`
(the Editor repo), and it does everything it does today. Lexical stays until that editor covers
every row below. Then `composerRichTextEnabled` lands for upstream parity (INTERACTION-11).

## What exists today

- Lexical 0.45 (`lexical`, `@lexical/react`) is used only by the composer:
  `features/chat/components/chat-input*.tsx`, `utils/input-editor-actions.ts`,
  `hooks/use-composer-inbox.ts`, `hooks/use-prompt-stash.ts`, and the density browser test.
- The editor root is `PlainTextPlugin` plus `HistoryPlugin` (`chat-input-editor.tsx`). Every other
  plugin is ours.
- Upstream T3 Code has since moved its composer to Tiptap
  (`references/t3code/docs/internals/composer-editors.md`): the draft store owns Markdown, chips
  count as one character in store cursors, and clipboard text comes from the Markdown serializer.

## Inventory (first pass, to confirm)

| Lexical use in the composer                                                                                        | Where                                                                         | Our editor today (first read)                                                         |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `@`-mention chips: a `DecoratorNode` rendering a React chip; the caret steps over it; one Backspace deletes it     | `chat-input-mention-node.tsx`, `chat-input-mention-plugin.tsx`                | Atomic inline replacements (`displayTransforms.ts`) with text; no DOM or React widget |
| Serialization: a chip's text content is `serializeComposerMention(path)`, so the buffer text is the message format | `chat-input-mention-node.tsx`, `input-editor-actions.ts`                      | Plain text buffer; a chip over its serialized text would match                        |
| Pasted images and files go to attachments; pasted serialized mentions become chips; large pastes fold to a file    | `chat-input-editor.tsx`, `chat-input-paste-fold-plugin.tsx`                   | Paste-handler registry by payload type (`pasteHandlers.ts`)                           |
| Programmatic text: draft sync from the store, inbox inserts, stash restore, range replace for the command menu     | `chat-input-draft-plugin.tsx`, `use-composer-inbox.ts`, `use-prompt-stash.ts` | Document edit APIs; parity of "replace without an undo entry" unknown                 |
| Cursor and text snapshot for trigger detection (`@`, `/`)                                                          | `$readChatInputTextSnapshot`                                                  | Selection and text reads exist                                                        |
| Key interception: Enter / Tab / arrows for send and the command menu, Up/Down prompt history, Home/End             | submit, history and line-boundary plugins                                     | Keymap runtime (`keymap/runtime.ts`)                                                  |
| IME: Enter during composition is swallowed (`isComposing`, keyCode 229)                                            | `chat-input-submit-plugin.tsx`                                                | EditContext is the default input route                                                |
| Surround a selection when typing a bracket or quote                                                                | `chat-input-surround-plugin.tsx`                                              | Auto-close store exists; surround-on-selection unknown                                |
| Undo/redo                                                                                                          | `HistoryPlugin`                                                               | Undo graph (Plan 121)                                                                 |
| Placeholder                                                                                                        | `PlainTextPlugin` placeholder                                                 | None found                                                                            |
| Auto-grow: `min-h-14 max-h-48`, then scroll                                                                        | `chat-input-editor.tsx`                                                       | Virtualized, fixed-height view; height from content not found                         |
| Word wrap, disabled/read-only, focus, `aria-label`                                                                 | `chat-input-editor.tsx`, draft plugin                                         | `setWordWrap`; others to confirm                                                      |
| The word "ultrathink" painted via CSS Highlights on the root element                                               | `chat-input-ultrathink-plugin.tsx`                                            | Range highlights exist                                                                |
| Markdown as you type                                                                                               | Not used today (plain text)                                                   | `@singapore-editor/markdown` inline replacements                                      |

## Research questions

1. Confirm and complete the inventory: anything the table misses (drag-and-drop of mentions,
   clipboard copy of chips, selection across a chip, accessibility of the chip).
2. For each row, what the editor has and the gap, with the Editor file that closes it.
3. The order to close the gaps. Plan 111's decoration layer (widgets, atomic ranges, caret
   semantics) comes first; then auto-grow and placeholder; then the host swap.
4. Cost: what a composer host adds to first load in chat mode, measured with Plan 109's report.
5. What to take from T3's Tiptap move: store-owned Markdown, chip cursor coordinates, serializer
   clipboard.

Deliverable: the gap table, the order, and the Editor and Platform plans it splits into.
