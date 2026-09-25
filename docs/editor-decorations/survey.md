# Editor decorations: survey and measurements (Plan 111 research, 2026-09-25)

Research notes behind [Plan 111](../../plans/111-editor-decorations.md). The plan carries the
answers, the decision record and the proposed phases; this file carries the teardown and the
numbers.

## Pinned sources

| Source                                         | Where                                               | Commit                                     |
| ---------------------------------------------- | --------------------------------------------------- | ------------------------------------------ |
| Platform                                       | origin/main                                         | `9f3438258`                                |
| Editor (`@singapore-editor/*`)                 | `/work/projects/Editor` main                        | `c23cd306c22c107741a4c27ee5afc39b8b99ad59` |
| `codemirror/view`                              | `references/codemirror-view`                        | `fbff59ba004d80d8c914f64c42586387b08706ac` |
| `codemirror/state`                             | `references/codemirror-state`                       | `9c801279cb83011e6f92af778f4443406e8f1200` |
| `codemirror/commands`                          | `references/codemirror-commands`                    | `5b9bac974f2c4af3e20b045adef949667872ecad` |
| `codemirror/lang-markdown`, `website`          | `references/codemirror-lang-markdown`, `-website`   | `8f73fd50…`, `84be9d74…`                   |
| `facebook/lexical` (main, 0.51.0; we run 0.45) | `references/facebook-lexical`                       | `5c08636fc99aa72468bcdf0d5ac59eccbe54c41e` |
| `obsidianmd/obsidian-api`                      | `references/obsidianmd-obsidian-api`                | `cc1744324150c632416857c98964f87b1574a5fc` |
| ixora (CM6 markdown live preview)              | `references/retronav-ixora`                         | `1734bce24307fd80c4ea538257efb6f612dc9715` |
| obsidian-latex-suite (CM6 conceal)             | `references/artisticat1-obsidian-latex-suite`       | `d2de90751e1e847d4a402fc66da1d13ce3565f6d` |
| lexical-beautiful-mentions                     | `references/sodenn-lexical-beautiful-mentions`      | `3fc5ca785c33137e2445c5f4c005e1d84df38a74` |
| Zed agent message editor (sparse)              | `references/zed` (`crates/agent_ui`, `display_map`) | `e91b82c106817f2419207ebf81f1da766698ac95` |

Editor paths below are relative to `/work/projects/Editor/packages/`.

## What `@singapore-editor` already has

The plan's "What we have today" table undercounts. There are six decoration channels, each with its
own position model:

| Channel                    | API                                                                                                               | Positions                                                             | Consumers                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------- |
| Inline replacement         | `registerInlineReplacementProvider`, `Editor.setInlineMap` (`editor/src/inlineMap.ts:32`)                         | Piece-table anchors, re-resolved for every range on every edit        | markdown preview, ghost text                      |
| Inline insertion (phantom) | same spec, `insertion: true` (`editor/src/displayTransforms.ts:121`)                                              | as above                                                              | ghost text (`editor/src/editor/ghostText.ts:119`) |
| Inline DOM widget          | same spec, `render(container)` returning `dispose` (`displayTransforms.ts:114`)                                   | as above; mounted `contenteditable=false`, measured by ResizeObserver | tests only (`editor/test/inlineWidgets.test.ts`)  |
| Range highlight (mark)     | `setRangeHighlight(name, ranges, style)`, `setRangeDecorations` with `zIndex`                                     | raw offsets, re-set by the owner                                      | LSP diagnostics, document highlights, links, diff |
| Edit-tracked decoration    | `EditorDecorationStore` (`editor/src/editor/decorationStore.ts:101`), surfaces `text`/`row`/`minimap`, 4-way bias | offsets, every entry visited per edit (`applyEdits`, `:169`)          | occurrence highlight                              |
| Row (line) decoration      | `setRowDecorations(sourceId, Map<row, …>)`                                                                        | buffer rows                                                           | diff                                              |
| Injected rows              | `registerInjectedTextRowProvider` (`InjectedTextRow`, `displayTransforms.ts:77`)                                  | anchor buffer row; fixed row height, text only                        | diff (deleted lines)                              |

Caret behaviour already in place:

- Replacements are atomic to motion. `previousRowUnitOffset`/`nextRowUnitOffset`
  (`editor/src/virtualization/virtualizedTextView.ts:1976-2002`) walk past every display unit that
  maps to one source point.
- Selections, find matches and tokens paint a replacement whole (`displayTransforms.ts:372`).
- `cursorStops: 'both' | 'left' | 'right' | 'none'` decide where a still caret rests beside an
  insertion (`displayTransforms.ts:497-537`).
- Reveal: every non-insertion replacement the caret or selection touches, plus its group, is dropped
  from the rendered map (`inlineMap.ts:112-136`); "touches" includes both edges (`:437-442`).

What is missing for a host that wants chips: no replacement can opt out of reveal; backspace and
delete edit one grapheme of source (`editor/src/editor/inputSelectionController.ts:1080-1085`, no
look-up of replacements); providers re-run only when a syntax result lands
(`editor/src/editor/syntaxController.ts:1259` → `Editor.setSyntaxCaptures`, `Editor.ts:1334`), so an
editor with no language never re-derives after an edit.

History: the Editor had a block-surface subsystem and deleted it on 2026-08-22 (`7974443`, 4,548
lines removed). The row-height index it fed is kept but unused: "nothing in production feeds
non-uniform sizes today" (`editor/src/virtualization/rowHeightIndex.ts:1`).

## CodeMirror 6

- One value type, four kinds: `Decoration.mark`, `.widget`, `.replace`, `.line`
  (`codemirror-view/src/decoration.ts:231-262`). `block: true` on widget and replace makes a
  block widget. Edge behaviour is `inclusiveStart`/`inclusiveEnd` (`:11-16`).
- `WidgetType` lifecycle: `eq`, `toDOM`, `updateDOM`, `estimatedHeight`, `lineBreaks`,
  `ignoreEvent`, `coordsAt`, `destroy` (`decoration.ts:106-163`). `eq` is what lets the view keep a
  mounted widget across rebuilds.
- `RangeSet` (`codemirror-state/src/rangeset.ts`) is chunked; `map(changes)` touches only chunks
  the change crosses. Measured below: mapping 200,000 ranges through a keystroke takes 0.05 ms.
- Sources are facets. Decorations from a `ViewPlugin` may not be block decorations or replace line
  breaks (`codemirror-view/src/buildtile.ts:517-519`); those must come from state so the height map
  can be computed before the viewport is known.
- Atomic ranges are a separate facet, `EditorView.atomicRanges` (`extension.ts:295`). Motion skips
  them (`cursor.ts:140-180`); `deleteCharBackward` widens the deletion to the whole atom
  (`codemirror-commands/src/commands.ts:550-556`).
- Heights: a height-map tree with estimated heights, a measure pass and scroll anchoring
  (`heightmap.ts`, `viewstate.ts:231-242`).
- The website's placeholder example (`codemirror-website/site/examples/decoration/placeholder.ts`)
  is the composer mention in miniature: a `MatchDecorator` derives `Decoration.replace({widget})`
  from a regex, and the same set is provided as `atomicRanges`.

## Lexical

- `DecoratorNode` (`packages/lexical/src/nodes/LexicalDecoratorNode.ts:72-97`): `decorate()`
  returns a React element, `isInline`, `isKeyboardSelectable`, `isIsolated`. The node is real
  document structure; its text content is whatever `getTextContent()` returns.
- Plain-text Lexical does not delete a decorator on Backspace. Platform re-implements it
  (`apps/web/src/features/chat/components/chat-input-mention-plugin.tsx`), and so does the most-used
  third-party mentions plugin (`lexical-beautiful-mentions/plugin/src/MentionComponent.tsx:195-225`,
  Backspace, Delete, both arrows). That plugin also shipped a placeholder node to fix the caret
  beside a decorator in Safari ([lexical#4487](https://github.com/facebook/lexical/issues/4487)).
- Platform spends most of `utils/input-editor-actions.ts` (431 lines) converting between Lexical
  points and flat text offsets, including counting a chip as the length of its serialized text
  (`:412-420`). The composer already thinks in offsets over a string.

## Real plugins

- **ixora** (CM6 markdown live preview): rebuilds decorations from the Lezer tree for the visible
  ranges on every update and reveals any construct the selection overlaps
  (`packages/ixora/src/util.ts:13-58`, `plugins/hide-mark.ts:44-58`). Recompute over the viewport;
  no mapping.
- **obsidian-latex-suite** conceal (`src/editor_extensions/conceal.ts`): replace decorations plus
  atomic ranges while concealed, and a reveal table keyed on the caret being `apart`, at the `edge`,
  or `within`, with an optional reveal delay (`:142-177`). Reveal policy is per construct.
- **Zed agent message editor**: a mention is an inline crease (a fold with a rendered placeholder)
  over the buffer's own link text, anchored bias-right/before
  (`crates/agent_ui/src/mention_set.rs:1084-1176`). Paste re-parses mention links and creates creases
  (`message_editor.rs:1230-1260`). Backspace removes a crease whole (test at
  `message_editor.rs:2604-2616`). This is the same move as Question 7, shipped: the chat input is the
  code editor, and a mention is a decoration over plain text.
- **Obsidian** itself exposes CM6 (`obsidian.d.ts:6-7`, `editorEditorField` at `:2597`,
  `registerEditorExtension` at `:5019`).

## Measurements

Probe: `/work/tmp/research/111/bench-editor.ts` and `bench-cm6.ts` (throwaway, not in the repo). Bun
1.4.0, i7-14700K, run in a wave-heavy slot. Median of 25 runs (7 at 100k lines), after 3 warm-up
runs. Document: one `**bold words**` per line, two hidden fences per line. Composer prompt: prose
with `@src/features/chat/components/file-N.tsx` mentions.

| Operation                                      | 1k lines (2k ranges) | 10k lines (20k) | 100k lines (200k) |
| ---------------------------------------------- | -------------------- | --------------- | ----------------- |
| Editor `createInlineMap`                       | 1.26 ms              | 12.7 ms         | 131 ms            |
| Editor `updateInlineMapForEdit`, one character | 0.58 ms              | 7.2 ms          | 83 ms             |
| Editor `revealInlineMap`, caret in a construct | 0.66 ms              | 7.9 ms          | 96 ms             |
| CM6 `RangeSet.of`                              | 0.062 ms             | 0.25 ms         | 2.4 ms            |
| CM6 `RangeSet.map`, one character              | 0.003 ms             | 0.006 ms        | 0.051 ms          |

A keystroke with an inline map runs `updateInlineMapForEdit` in the projection
(`virtualization/displayProjection.ts:566`), again on the unrevealed base when the caret is revealing
something (`virtualizedTextViewLayout.ts:113-116`), then `revealInlineMap` for the moved selection
(`virtualizedTextView.ts:736-745`): two to three O(ranges) passes, about 15–22 ms at 10k markdown
lines against a 1–2 ms typing budget.

Composer scale is free: 325 characters with 5 mentions, 0.004 ms to build; 3,290 characters with 50
mentions, 0.021 ms to build and 0.015 ms to map.

Row-height index (the only variable-height structure the Editor has):

| Rows      | Build   | One row resized at 10% | …of which the caller's array copy |
| --------- | ------- | ---------------------- | --------------------------------- |
| 100,000   | 0.31 ms | 0.50 ms                | 0.42 ms                           |
| 1,000,000 | 3.8 ms  | 5.7 ms                 | 4.5 ms                            |

It is dense (8 bytes per row of starts plus the sizes array) and wants a fresh sizes array per
change.

## Composer requirements against the Editor

From the owner ruling in [Plan 126 INTERACTION-11](../../plans/126-t3code-alignment/interaction.md):

| Requirement                   | Lexical today                                                        | Editor today                                                                                                                                      | Needed                                                                                |
| ----------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Mention chips                 | `ChatInputMentionNode extends DecoratorNode`                         | Replacement with `render`; motion already atomic                                                                                                  | Reveal opt-out, atomic delete, re-derive on edit                                      |
| Pasted images and attachments | `onPaste` + `PASTE_COMMAND` plugin                                   | `EDITOR_PASTE_HANDLER` sees `files`, `types`, `text`, targets (`editor/src/plugins.ts`)                                                           | Host handler; drop stays on the container                                             |
| Large-paste fold              | `chat-input-paste-fold-plugin.tsx`                                   | same paste handler                                                                                                                                | Host handler; the paste-as-text chord needs the key context                           |
| Markdown as you type          | absent (`PlainTextPlugin`)                                           | `@singapore-editor/markdown` (Tree-sitter captures)                                                                                               | Load the grammar in the composer; AST re-source is Plan 108 D5                        |
| IME composition               | contenteditable                                                      | EditContext on Chromium, textarea elsewhere (`virtualizedTextViewComposition.ts`)                                                                 | Verify in a composer scenario, desktop and phone                                      |
| Undo/redo                     | `HistoryPlugin`                                                      | Document history, snapshot based                                                                                                                  | none                                                                                  |
| Placeholder                   | overlay `div`                                                        | none                                                                                                                                              | Host overlay while the text is empty, as today                                        |
| Auto-growing multiline        | CSS `min-h-14 max-h-48` on contenteditable                           | `scrollMode: 'static'` plus a host-computed height (search excerpts do this, `features/search/utils/result-editor.ts:356-366`)                    | A content-height signal that counts wrapped rows                                      |
| Serialization                 | `getTextContent` + node walk                                         | The buffer text is the message                                                                                                                    | none; most of `input-editor-actions.ts` goes                                          |
| Prose font, soft wrap         | browser layout                                                       | Wrap counts columns of `characterWidth` ([E052](../../../Editor/plans/e052-proportional-font-extents.md), Proposed, P3)                           | E052, and wrap that keeps a replacement on one row (`docs/display/transforms.md:274`) |
| Spellcheck, autocorrect       | browser default on contenteditable                                   | textarea has `spellcheck=false`, `autocapitalize=off` (`virtualization/virtualizedTextViewHelpers.ts:182-197`); text is painted outside the input | Input options for prose; native squiggles are not possible (owner question)           |
| "ultrathink" colouring        | CSS Highlight API over Lexical's DOM (`state/ultrathink-highlights`) | `setRangeHighlight`                                                                                                                               | none                                                                                  |
