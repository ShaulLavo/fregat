# Plan 171: The chat composer runs on our own editor

## Status and authorization

- Status: RESEARCH DONE (2026-09-25) — verified gap table, order and proposed phases below; Plan 111's three
  owner questions are answered (2026-09-26). Nothing here authorizes implementation.
- Priority: P2. The composer works today; this removes a second editor framework.
- Planned at: Platform `9f343825`, Editor `e2fd299`, 2026-09-25. Origin: Plan 126
  [INTERACTION-11](126-t3code-alignment/interaction.md) owner ruling.
- Depends on: [Plan 111](111-editor-decorations.md) (decorations, question 7) first, and the Editor
  spellcheck, [Editor E058](../../Editor/plans/e058-spellcheck.md) (owner, 2026-09-26).

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

## Research findings (2026-09-25)

Read from Platform origin/main `a3768d4e` and Editor origin/main `e2fd299` (the Editor checkout's
source matches it; the five commits it lacks are plans only). No PR branch carries this plan. Plan 111's
findings landed during this research (`cc23c6b3`); this section builds on its gap table and
[survey](../docs/editor-decorations/survey.md) and corrects it where a probe disagreed. Editor paths
are relative to `Editor/packages/editor/src/`.

**Probe.** The Editor's built `dist` (built after its last source change) was bundled with
`bun build` and driven in headless Chromium through Playwright 1.63: `Editor` with
`inputRoute: 'edit-context'`, a replacement provider that turns `@path` into a `render` widget, then
caret moves, Backspace and an edit. Scripts are in `/work/tmp/research/171/probe/`. Results are cited
as "probe".

### Q1–Q2. The verified gap table

The first-pass table had two rows wrong ("no DOM or React widget": the Editor renders widgets;
"height from content not found": the block is scroll padding, below) and missed seven rows (15–21).

| #   | Composer need                           | Editor today (verified)                                                                                                                                                                                                                                                                                                                                  | Gap                                                                                                                                                                                      | Closes it                       | Effort      |
| --- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------- |
| 1a  | Chip as a widget                        | `InlineReplacementSpec.render(container)` (`inlineMap.ts:32-47`) mounts a `contenteditable=false` span keyed by replacement id and measures its width (`virtualization/virtualizedTextViewRows.ts:1453-1500`). Probe: `[chip]` paints in place of `@src/foo.ts`.                                                                                         | Mount keyed by `id`; a derived id moves with the text before it, so the chip remounts on every edit ahead of it                                                                          | Editor: widget `key` (Plan 111) | S           |
| 1b  | Caret never shows the source            | Every non-insertion replacement a selection touches is dropped (`inlineMap.ts:112-136`, applied at `virtualization/virtualizedTextView.ts:736-747`). Probe: caret at the chip's end shows `@src/foo.ts`.                                                                                                                                                 | Per-replacement `reveal: 'never'`                                                                                                                                                        | Editor (Plan 111)               | S           |
| 1c  | Caret steps over a chip                 | Visual motion walks display units (`virtualization/virtualizedTextView.ts:1976-2002`). Logical motion steps source code points (`editor/navigationTargets.ts:505-522`), and so does word motion. Probe, logical: 15, 14, 13 inside the chip. Probe, visual: Left from 16 lands on 4, skipping the space at 15.                                           | Atomic stops on the logical and word paths (the Windows default, `rtlMoveVisually`); fix the one-unit overshoot next to a measured widget                                                | Editor                          | S–M         |
| 1d  | One Backspace deletes a chip            | Delete removes one grapheme of source. Probe: Backspace at the chip's end leaves `@src/foo.t`.                                                                                                                                                                                                                                                           | Widen Backspace, Delete and word-delete over atomic ranges                                                                                                                               | Editor (Plan 111)               | S           |
| 1e  | A new mention becomes a chip            | Providers rerun only when captures land, a provider registers or a suggestion changes (`editor/Editor.ts:1329-1363`). Probe: an edit adding `@a/b.ts` calls the provider 0 times and shows no chip until the provider is registered again.                                                                                                               | Sources that rerun inside the edit operation                                                                                                                                             | Editor: `trigger: 'edit'` (111) | S–M         |
| 2   | Buffer text is the message              | The buffer holds `@path`; copy writes buffer text plus coloured HTML (`editor/inputSelectionController.ts:2835-2853`)                                                                                                                                                                                                                                    | None. The offset walk in `input-editor-actions.ts` (431 lines) goes                                                                                                                      | —                               | —           |
| 3   | Paste: files, serialized mentions, fold | `EDITOR_PASTE_HANDLER` gets `files`, `types`, `text`, `targets` and returns text per target (`plugins.ts:819-880`)                                                                                                                                                                                                                                       | Host handler: files and fold return `''` and start async work. Returning `''` also deletes a selection, which Lexical keeps; decide in the scenario                                      | Platform                        | S           |
| 4   | Programmatic text                       | `syncText` is a minimal diff with `history: 'skip'` and no DOM selection write (`editor/Editor.ts:1461-1500`). `edit(edits, { history, selection })` is one undo step (`editor/types.ts:174-186`).                                                                                                                                                       | None. Draft sync becomes `syncText`; inbox, menu commit and mention insert become `edit`                                                                                                 | —                               | —           |
| 5   | Text and caret for `@` and `/`          | `onChange(state, change)`; selections through `@singapore-editor/react`'s store (`EditorViewSnapshot.selections`, `plugins.ts:470-493`) or a contribution's `getSelections()`. `Editor` itself exposes only `cursor {row, column}`.                                                                                                                      | None blocking; a public offset `getSelection()` would save the host a store                                                                                                              | Editor (optional)               | XS          |
| 6   | Enter, Tab, arrows, Home/End, history   | The editor keymap takes only built-in `EditorCommandId`s (`editor/commands.ts:10`). A capture-phase listener on the composer wrapper runs first, as Lexical's high-priority commands do today.                                                                                                                                                           | Host listener with its own `isComposing`/229 guard. Platform: see row 21                                                                                                                 | Platform                        | S           |
| 7   | IME                                     | EditContext on Chromium, textarea elsewhere; the keymap ignores composing keys (`keymap/runtime.ts:133`)                                                                                                                                                                                                                                                 | Verification only: desktop and phone scenarios                                                                                                                                           | Platform scenario               | S           |
| 8   | Surround a selection                    | `surroundSelection` exists (`editor/inputSelectionController.ts:857-890`), fed by the language's `autoClosingPairs` (`editor/autoClose.ts:21-32`)                                                                                                                                                                                                        | Surround pairs are the auto-close pairs. The composer wraps with 11 pairs (`input-logic.ts:110-122`) and auto-closes nothing; needs separate pairs and auto-close off                    | Editor                          | S           |
| 9   | Undo/redo                               | Document history; `syncText` stays out of it                                                                                                                                                                                                                                                                                                             | None. Draft sync stops adding undo entries, which Lexical's `HistoryPlugin` records today                                                                                                | —                               | —           |
| 10  | Placeholder                             | None                                                                                                                                                                                                                                                                                                                                                     | Host overlay while empty, as Lexical's is; `aria-placeholder` on the input element                                                                                                       | Platform                        | XS          |
| 11  | Auto-grow `min-h-14 max-h-48`           | Virtualized mode always adds `viewport − last row` of scroll room (`virtualization/fixedRowVirtualizer.ts:1100-1107`). Probe: 4 lines in a 192 px cap scroll 264 px, so a CSS-sized host jumps to the cap at line 2. Static mode clips `overflow-y` (`style.css:117-120`) and cannot scroll past the cap.                                                | An option to turn scroll-past-end off, and a content-height signal that counts wrapped rows                                                                                              | Editor                          | S–M         |
| 12  | Wrap, read-only, focus, label           | `setWordWrap`, `setEditability` (syncs `aria-readonly`, `virtualizedTextView.ts:982`), `focus()` exist. `aria-label` is fixed to "Editor input" (`virtualization/virtualizedTextViewHelpers.ts:175,189`); scenarios find the composer as textbox "Message" (`scripts/agent/selectors.ts:596`). Wrap breaks at code units, measured in monospace columns. | Label option. **Word-boundary wrap**, which E052 excludes ("No word-boundary wrapping", `Editor/plans/e052-proportional-font-extents.md`). E052 itself for Inter. A chip kept on one row | Editor                          | XS; M; L; M |
| 13  | "ultrathink" colours                    | `setRangeDecorations` with `style.color` (`editor/types.ts:46-57`)                                                                                                                                                                                                                                                                                       | None                                                                                                                                                                                     | Platform                        | XS          |
| 14  | Markdown as you type                    | `@singapore-editor/markdown` over Tree-sitter captures for language `markdown`, reveal on touch                                                                                                                                                                                                                                                          | Grammar load in the composer; chips outrank markdown replacements (source priority, Plan 111 Q4); list continuation absent from the markdown language rules                              | Editor + Platform               | M           |
| 15  | Drop a tree row → chip                  | The Editor's own drop handler inserts `text/plain` at the pointer and calls `preventDefault` (`editor/inputSelectionController.ts:2795-2830`). A tree row drags its absolute path as `text/plain` (`packages/tree/src/hooks/useFileTreeDrag.ts:246`).                                                                                                    | The container's `onDrop` runs after the insert: the raw path lands, then the chip. Route drops through the paste-handler registry, or claim them in capture                              | Editor (or Platform capture)    | S           |
| 16  | Copying a chip                          | Copy reads buffer text: the serialized mention                                                                                                                                                                                                                                                                                                           | None                                                                                                                                                                                     | —                               | —           |
| 17  | Selecting across a chip                 | Selection paints a replacement whole (`displayTransforms.ts:372`)                                                                                                                                                                                                                                                                                        | None                                                                                                                                                                                     | —                               | —           |
| 18  | Screen readers                          | The input carries an accessible window of buffer text (`editor/inputSelectionController.ts:3730-3740`), so a chip reads as its path                                                                                                                                                                                                                      | Verify in the scenario                                                                                                                                                                   | Platform scenario               | —           |
| 19  | Spellcheck, autocorrect, capitalize     | Lexical defaults `spellCheck` on (`@lexical/react` `LexicalContentEditableElement.tsx:55`). Editor: textarea `spellcheck=false`, `autocapitalize=off`; probe: the EditContext host reports `spellcheck` false                                                                                                                                            | Native squiggles are impossible (text is painted outside the input). Prose input options for mobile keyboards                                                                            | Editor + owner (Plan 111 Q2)    | S           |
| 20  | Tab leaves the composer                 | `tabMovesFocus` option (`editor/types.ts:145-149`)                                                                                                                                                                                                                                                                                                       | None                                                                                                                                                                                     | —                               | —           |
| 21  | App shortcuts stay out while typing     | Platform yields chords to inputs, textareas and `isContentEditable` (`apps/web/src/keymap/utils/keyboard-event.ts:13-24`). Probe: the EditContext host has `isContentEditable` false and does not match `:read-write`.                                                                                                                                   | The composer stops counting as text entry, so app chords fire while typing. Plan 172's undo routing rule 1 relies on it too                                                              | Platform                        | XS          |

### Q3. Order to close them

Ranked by effort, the Editor gaps are: XS label option; S scroll-past-end option, surround pairs,
drop routing, `reveal`, atomic delete, widget `key`, prose input options; S–M atomic logical and word
motion, edit-triggered sources, content height; M word-boundary wrap, chip kept on one row; L E052.
The Platform gaps are: XS text-entry detection, placeholder, ultrathink; S paste, keys, IME and
screen-reader scenarios; M the host swap as a whole.

**Recommendation: this order.**

1. **Chip semantics (Editor).** Rows 1a–1e: `reveal`, atomic delete, atomic motion on every path,
   edit-triggered sources, widget `key`. This is Plan 111 Phase 1's first half. The motion overshoot
   is a live bug for inlay hints and ghost text too.
2. **Host shape (Editor).** Rows 8, 11, 12 (label), 15, 19: scroll-past-end off, content height,
   surround pairs apart from auto-close, drops through the handler registry, label, prose input
   options. Plan 111 Phase 1's second half, plus the three rows it did not list (surround, drop,
   scroll padding).
3. **Prose wrap (Editor).** Word-boundary breaks, then E052. Word-boundary breaks gate the swap in
   any font: the composer wraps `break-words` today, and code-unit breaks split words mid-letter.
   E052 gates it only if the composer keeps Inter (Plan 111 owner question 1).
4. **Host swap (Platform).** Row 21 first, since it is a one-line guard. Then the host, the mention
   source with the chip as `render`, paste and drop, keys, ultrathink, placeholder, auto-grow, and a
   `chat-composer-editing` scenario (IME, phone width, screen reader). Lexical is deleted in the same
   pass that the scenario passes: greenfield, no flag.
5. **Rich text (Editor + Platform).** Row 14 with source priority, then `composerRichTextEnabled`.

### Q4. Cost

Measured with `bun run --cwd apps/web bundle:report --dir=/work/platform-production/current/web`
(the reporter Plan 109 uses; the release has `bundle-stats.json`), release
`20260925T173354Z-ed96e9f1-main`. First-load JS is 1,639 KB gz.

- `@singapore-editor/core` is 221.8 KB gz of first load and 221.8 KB gz total: all of it already
  loads first. `@singapore-editor/react` adds 3.6 KB, also already first-load. **A composer host adds no
  package bytes.**
- Lexical is 45.8 KB gz, all first-load: `lexical` 29.8, `@lexical/extension` 4.9, `/html` 4.9,
  `/react` 1.7, `/clipboard` 1.3, `/history` 1.0, `/utils` 0.9, `/plain-text` 0.5, and four under
  0.4. **Deleting it saves 2.8% of first-load JS.**
- Markdown as you type loads the Tree-sitter markdown grammar lazily (the languages package is
  4.3 KB first-load, 1.5 MB gz lazy); a chat-only session would pay it only with rich text on.
- Runtime: `new Editor(...)` plus `setText` of a one-line prompt took 1.5 ms median, 2.3 ms p90,
  over 25 mounts (probe `run4.mjs`, headless Chromium, first paint excluded).

### Q5. What T3's Tiptap move teaches

T3 replaced Lexical 0.41 with Tiptap 3.31 in one commit (`d359e94c`, 2026-09-16, +3,558/−4,072): a
1,389-line `ComposerPromptEditorTiptap.tsx`, a 652-line pure document model
(`composer-rich-text-doc.ts`) and four follow-up fixes (`2d8f9a8f` timeline jump when the composer
expands, `9030a60e` chip rings clipped at the editor edge, `a4bc7deb` Escape, `dca84efb` pasted inline
code).

- **Store-owned Markdown.** Their store holds Markdown and the editor holds a ProseMirror document,
  so every load parses and every edit serializes, and rich mode canonicalizes `__` to `**`. Our buffer
  is the store's text: no parse, no serialize, no canonical form, and the rich-text setting adds or
  removes a decoration source instead of remounting. Take the rule under it: **replace content only
  when the stored text changes**, which `syncText` already enforces by diffing.
- **Chip coordinates.** They convert between three spaces (ProseMirror positions, "collapsed" with a
  chip as one character, Markdown with its source) in the doc model. Ours need none: store cursor,
  trigger ranges and buffer offsets are one space. What replaces the conversion is atomicity: no
  caret, selection edge or delete may land inside a chip (rows 1b–1d).
- **Serializer clipboard.** Theirs exists because DOM text omits a chip's source. Ours reads the
  buffer (row 16). Their structured context payload on copy has no local counterpart yet.
- **Also worth taking.** Paste completes chip boundaries: a trailing space after a pasted mention and
  a leading one when it lands against text (`ComposerPromptEditorTiptap.tsx:942-977`); with derived
  chips this is what keeps `foo@a.ts` from staying text. Surround refuses to wrap a chip
  (`:915-941`). They hand-wrote atomic Left/Right even on ProseMirror (`:834-857`), which is row 1c:
  the editor has to own it. Programmatic moves scroll the caret into view explicitly. Enter during
  composition is swallowed exactly as ours is.
- **What to leave.** Rich task lists, block splitting on Enter and mark-preserving splits are
  ProseMirror structure; a plain buffer gets list continuation from language rules instead.

### Owner questions

None new. Plan 111's three (composer font and wrap, native spellcheck, hand-typed mentions) are
this plan's too. One refinement to its question 1: option (b), the coding font, still needs
word-boundary wrap, so wrap work is on the path in every option.

- Decided 2026-09-26: owner — Plan 111 question 1 (a): E052 plus word-boundary wrap are composer prerequisites.
- Decided 2026-09-26: recommendation (owner deferred) — Plan 111 question 3 (a): a hand-typed `@path` becomes a chip once complete.
- Decided 2026-09-26: owner — Plan 111 question 2 (b): Lexical stays until the Editor has its own spellcheck. Editor spellcheck is a prerequisite of phase 3.

### Proposed phases

Numbers are the coordinator's.

1. **Editor: atomic replacements for hosts** (Plan 111 Phase 1, S–M), extended with atomic logical
   and word motion, the overshoot fix, scroll-past-end off, surround pairs apart from auto-close,
   drops through the handler registry and a label option. Each proven on `new Editor(element)`.
2. **Editor: prose wrap** (M, then L). Word-boundary breaks and a chip kept on one row, then E052.
3. **Platform: composer on our editor** (M, one lane). Text-entry guard (row 21), host, mention source
   and chip, paste and drop, keys, ultrathink, placeholder, auto-grow, scenario; Lexical and both
   dependencies deleted in the same pass.
4. **Platform + Editor: rich text.** Markdown source with priority below chips, list continuation,
   then `composerRichTextEnabled`.
