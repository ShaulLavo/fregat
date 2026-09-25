# Ask the editor; do not model it

Status: **PHASES 1, 2 AND 4 IMPLEMENTED — PHASES 3 AND 5 NEED EDITOR APIs.** Requested
2026-09-21, after the diff line-comment fix. Inspected at Platform `d1ca6472` and Editor
`aeba6783`.

The line-comment layer used to find the clicked diff row by reading `data-editor-virtual-row` and a
pane class, re-running the diff projection to index into it, and relying on a runtime guard
(`documentModeViolations`) to warn when the assumption broke. `diffRowAtEvent` replaced all three.
An audit the same day found the pattern again, in nine places on the Platform side of the
Editor boundary. This plan removes them. Its Editor counterparts are
[E047](../../Editor/docs/display/e047-point-queries.md) and
[E050](../../Editor/plans/e050-host-obligations-into-api.md).

## What is on the table

| #   | Where                                                                        | What the host does instead of asking                                                                                                                                                                                                                   | Verified     |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| 1   | `features/search/utils/result-editor.ts:291-313`                             | Finds the clicked result line as `floor(offsetY / (22 + gap))`. The 22 lives in `result-editor-constants.ts`, `globals.css` (`--editor-row-height`) and a `leading-[22px]` in `result-source-line-gutter.tsx`; nothing checks them against each other. | yes          |
| 2   | `features/editor/state/unicode-hover-plugin.ts:45-92`                        | Reads a text offset out of `data-editor-hidden-character-offset` and hit-tests the markers with `getBoundingClientRect`, first match wins.                                                                                                             | pattern seen |
| 3   | `features/editor/utils/position.ts:17-47`, `utils/text-snapshot.ts:65-127`   | Two host copies of line-start lookup that walk chunks counting `\n`. `TextSnapshot.lineStart`, `lineRange` and `lineAt` exist. `offsetForPosition` is on the go-to-definition path.                                                                    | no           |
| 4   | `features/git/utils/diff-line-selection.ts` (`stackedDiffRows`)              | Re-runs the stacked projection from the plugin's expansion state, because in split mode no plugin holds one.                                                                                                                                           | yes          |
| 5   | `features/editor/components/diff-pane.tsx:140-160`                           | Re-applies tokens after every `setText`, inside a five-step order the editor does not enforce.                                                                                                                                                         | yes          |
| 6   | `features/settings/utils/apply-appearance.ts:59-71`                          | Writes `--editor-font-size`, `--editor-row-height`, `--editor-tab-size` on `:root`; the editor writes the same variables itself.                                                                                                                       | no           |
| 7   | `features/editor/utils/row-height-audit.ts`, `hooks/use-row-height-audit.ts` | A runtime guard (`editor.layout.row_height_mismatch`) whose only job is to notice item 6 falling out of step.                                                                                                                                          | no           |
| 8   | `features/editor/utils/diff-scroll-bridge.ts:17-69`                          | Listens to the raw `scroll` event and depends on the virtualizer's listener having registered first.                                                                                                                                                   | no           |
| 9   | `features/editor/utils/diff-language-plugin.ts:109-127`                      | Wins a modified click with a capture-phase `mousedown` and `stopImmediatePropagation`; writes `style.cursor` on the editor's scroll element.                                                                                                           | no           |
| 10  | `packages/ui/src/styles/globals.css:850-976`                                 | Themes the diff palette, caret, inactive selection and popups with `!important` against editor-internal classes, correct by stylesheet order.                                                                                                          | no           |

Lower, recorded so they are not rediscovered: `file-path.ts` keeps a second extension-to-language
table beside the package's metadata; `indentation-guides.ts` hardcodes which languages lack scope
lines; `plugins.ts:68` keys the fold chevron on `data-editor-fold-state`; `performance-trace.ts`
counts editor internals by class name (diagnostic only).

## Decisions

- D1: search results get the clicked line from `Editor.rowAtPoint` (E047 D2), not from a plugin
  written for the purpose. If E047 keeps the query plugin-only, Phase 1 adds a two-line plugin.
- D2: item 4 is fixed in the diff package (`plugin.getStackedRows()`), not by keeping the host copy
  and adding a test that pins it. The plugin already owns the expansion state.
- D3: items 6 and 7 are one change. The audit is deleted in the same pass that makes typography an
  editor option; it is not kept "just in case".

## Phase 1 — point queries (needs E047)

Search result click and hover use `rowAtPoint`. Delete `searchResultFileLineIdAtClientY`,
`searchResultFileLineIdAtOffsetY` and the `leading-[22px]` literal; the row height has one source.
Unicode hover uses `markerAtPoint`; delete the marker scan.

Scenarios: add `search-result-line-pick` (click a result line in a multi-line excerpt, assert the
selected line) and run the existing unicode hover surface with `look`.

Implemented 2026-09-23. `rowAtPoint` has no Y-only form and answers null outside the editor's box,
but the source-line gutter and the action column sit beside it and share its rows; the open and
replace buttons only show while their row is hovered. The query is therefore made at the editor
host's horizontal centre with the pointer's Y, and a row gap still answers null. The gutter takes
its line height from `EXCERPT_EDITOR_LINE_HEIGHT` through its style. A keyboard hover has no point,
so the unicode hover asks `markerAtPoint` at the character's own `getRangeClientRect` box; no
`data-editor-hidden-character*` read remains.

Verification: `search-result-line-pick` hovers a text row, the action column and a row gap, then
picks source line 4 (the third excerpt row) from the gutter and proves it by the opened editor's
cursor line. `editor-markdown-punctuation` gained a keyboard Show hover on the zero-width
character. Evidence: `/work/tmp/fregat-evidence/20260923T135447Z-scenario-search-result-line-pick/`,
`/work/tmp/fregat-evidence/20260923T135636Z-scenario-editor-markdown-punctuation/`.

## Phase 2 — delete the duplicate line index (implemented)

Replace `rowStartOffset`, `textLineAt` and `textSnapshotRowStartOffset` with `TextSnapshot.lineStart`
and `lineRange`. Diff behaviour first, per the repository rule on same-sounding helpers: the host
copies carry their own `\r` handling, so add a call-site test for a CRLF file before deleting.

Implemented 2026-09-21. Definition and commit-message offsets now use `lineStart`;
reference previews and search replacement use `lineRange`, retaining CR trimming and explicit
out-of-range handling. Deleted the host line-index scans and their obsolete helper tests.

Verification: 15 focused tests pass, including raw CRLF definition offsets, CRLF replacement
edits, and normalized document reference previews. Web and script typechecks, focused lint,
and repository gates pass. `editor-definition-crlf` follows a definition into a CRLF fixture
and proves the caret offset by inserting and checking the saved file. The editor normalizes
saved line endings to LF. Screenshot inspected; evidence:
`/work/tmp/fregat-evidence/20260921T174304Z-scenario-editor-definition-crlf/`.
The capture also records a `LoadedTerminalPanel` React `use()` error outside the changed code.

E047 has since landed (Editor `6656eb7`); E050, `getStackedRows` and `onDidScroll` are still
absent, so Phases 3 and 5 wait on the Editor.

## Phase 3 — stacked rows from the plugin (small Editor change)

`DiffPlugin.getStackedRows()`. `stackedDiffRows` and its test move to the package.

## Phase 4 — tidy the fix that started this (ready after E047)

`diffRowAtEvent` stops reading the row attribute and loses its private Y scan; both are replaced
by `rowAtPoint`. Scenario `git-diff-line-comment` already covers it.

Done in the Editor with E047: `rowHitAt` in `packages/diff/src/editorDiffPlugin.ts` asks
`context.rowAtPoint`, and nothing in the package reads `data-editor-virtual-row`.

## Phase 5 — obligations (each needs its E050 row)

Tokens with `setText` (item 5; done 2026-09-24, `diff-pane.tsx` passes them with the text, scenario
`git-diff-expand-tokens`), typography options and the audit's deletion (6, 7; done 2026-09-25,
the editor, diff and search editors pass `fontSize`, `fontFamily` and `lineHeight`, `:root` carries
only `--font-mono`, scenario `editor-typography`; `editor.lineHeight` had never reached the editor
before), `onDidScroll` (8; done 2026-09-25, `diff-pane.tsx` subscribes to `Editor.onDidScroll`
and `diff-scroll-bridge.ts` is deleted; the mirror's own report arrives from inside
`setScrollPosition`, so `use-diff-panes.ts` recognises it by a flag set around the write and the
position-matched echo guess, Plan 133 item 17, is gone; browser test `diff-split-scroll` passes,
including panes never seen at different offsets while a wheel turns), the pointer participant (9; done 2026-09-24, `diff-language-plugin.ts` claims its
Ctrl+click through `registerPressParticipant`, scenario `editor-press-participants`), theme keys (10). Each lands when its Editor half does; none blocks
another.

## Verification

Per phase, the scenario named above plus `look` on the changed surface, evidence under
`/work/tmp/fregat-evidence/`. Phase 2 is proven by its call-site tests and a go-to-definition
`look` on a CRLF file. No phase is done on a typecheck alone.

## What this plan does not do

It does not touch Platform's own workbench DOM (`data-editor-tab-*`, `data-editor-group-*`), which
Platform owns; that is plan 133. It does not redesign the diff plugin's
document ownership (E050 D1).
