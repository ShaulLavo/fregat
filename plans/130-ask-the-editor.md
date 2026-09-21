# Ask the editor; do not model it

Status: **PROPOSED — PHASE 1 NEEDS EDITOR E047; PHASES 2 AND 4 ARE READY NOW.** Requested
2026-09-21, after the diff line-comment fix. Inspected at Platform `d1ca6472` and Editor
`aeba6783`.

The line-comment layer used to find the clicked diff row by reading `data-editor-virtual-row` and a
pane class, re-running the diff projection to index into it, and relying on a runtime guard
(`documentModeViolations`) to warn when the assumption broke. `diffRowAtEvent` replaced all three.
An audit the same day found the pattern again, in nine places on the Platform side of the
Editor boundary. This plan removes them. Its Editor counterparts are
[E047](../../Editor/plans/e047-point-and-row-queries.md) and
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

## Phase 2 — delete the duplicate line index (ready now)

Replace `rowStartOffset`, `textLineAt` and `textSnapshotRowStartOffset` with `TextSnapshot.lineStart`
and `lineRange`. Diff behaviour first, per the repository rule on same-sounding helpers: the host
copies carry their own `\r` handling, so add a call-site test for a CRLF file before deleting.

## Phase 3 — stacked rows from the plugin (small Editor change)

`DiffPlugin.getStackedRows()`. `stackedDiffRows` and its test move to the package.

## Phase 4 — tidy the fix that started this (ready after E047)

`diffRowAtEvent` stops reading the row attribute and loses its private Y scan; both are replaced
by `rowAtPoint`. Scenario `git-diff-line-comment` already covers it.

## Phase 5 — obligations (each needs its E050 row)

Tokens with `setText` (item 5), typography options and the audit's deletion (6, 7), `onDidScroll`
(8), the pointer participant (9), theme keys (10). Each lands when its Editor half does; none blocks
another.

## Verification

Per phase, the scenario named above plus `look` on the changed surface, evidence under
`/work/tmp/fregat-evidence/`. Phase 2 is proven by its call-site tests and a go-to-definition
`look` on a CRLF file. No phase is done on a typecheck alone.

## What this plan does not do

It does not touch Platform's own workbench DOM (`data-editor-tab-*`, `data-editor-group-*`), which
Platform owns; that is [plan 133](133-one-owner-per-fact.md). It does not redesign the diff plugin's
document ownership (E050 D1).
