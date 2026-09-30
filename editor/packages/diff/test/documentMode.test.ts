import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Editor } from '@singapore-editor/core/editor'
import { createVisibleEditor } from './support/visibleEditor'
import type { EditorToken } from '@singapore-editor/core/syntax'
import type { VirtualizedTextRowDecoration } from '@singapore-editor/core/rendering'
import { createDiffEditorOptions, createTextDiff } from '../src'
import { joinRenderLines } from '../src/lines'
import { createStackedProjection } from '../src/projection'
import type { DiffRenderRow } from '../src/types'
import { highlightRangesWithin, installHighlightPolyfill } from './support/highlightPolyfill'

// The gate for document-mode diffing: a real `Editor` holding the synthetic interleaved buffer
// must highlight, select and copy a *deletion* row — the thing `overlay` mode can never do, and
// therefore the reason `document` mode exists.
//
// The inverse of test/overlayModeLimits.test.ts, which asserts the same things about an injected
// row and gets: tokens borrowed from the anchor line's buffer offsets, and no text offset at all
// for a point inside the row — so no caret, no selection, no copy. Here the rows are real document
// lines, so every one of those works on its own text. Read the two files together; either one alone
// only tells half of why `document` mode exists.

let container: HTMLElement | null = null
let editor: Editor | null = null

beforeAll(() => {
  installHighlightPolyfill()
})

afterEach(() => {
  editor?.dispose()
  container?.remove()
  editor = null
  container = null
})

describe('document-mode diff editor', () => {
  it('paints syntax tokens on a deletion row', () => {
    const mounted = mountDocumentModeDiff()

    const deletion = mounted.container.querySelector<HTMLElement>('.editor-diff-row-deletion')
    expect(deletion?.textContent).toBe('old')
    expect(highlightRangesWithin(deletion!)).not.toHaveLength(0)
  })

  it('paints syntax tokens on an addition row too, from the same buffer', () => {
    const mounted = mountDocumentModeDiff()

    const addition = mounted.container.querySelector<HTMLElement>('.editor-diff-row-addition')
    expect(addition?.textContent).toBe('new')
    expect(highlightRangesWithin(addition!)).not.toHaveLength(0)
  })

  it('puts the caret on a deletion row when selected', () => {
    const mounted = mountDocumentModeDiff()
    const deletionRow = mounted.rows.findIndex((row) => row.type === 'deletion')
    const deletionStart = rowStartOffset(mounted.rows, (row) => row.type === 'deletion')

    mounted.editor.setSelection(deletionStart, deletionStart + 'old'.length)

    expect(mounted.editor.getState().cursor).toEqual({ row: deletionRow, column: 3 })
  })

  it('copies deletion-row text with no +/- marker', () => {
    const mounted = mountDocumentModeDiff()
    const deletionStart = rowStartOffset(mounted.rows, (row) => row.type === 'deletion')
    mounted.editor.setSelection(deletionStart, deletionStart + 'old'.length)

    expect(copyFrom(mounted.container)).toBe('old')
  })

  it('copies a selection spanning a deletion and an addition row', () => {
    const mounted = mountDocumentModeDiff()
    const deletionStart = rowStartOffset(mounted.rows, (row) => row.type === 'deletion')
    const additionStart = rowStartOffset(mounted.rows, (row) => row.type === 'addition')

    mounted.editor.setSelection(deletionStart, additionStart + 'new'.length)

    expect(copyFrom(mounted.container)).toBe('old\nnew')
  })
})

type MountedDocumentModeDiff = {
  readonly container: HTMLElement
  readonly editor: Editor
  readonly rows: readonly DiffRenderRow[]
}

function mountDocumentModeDiff(): MountedDocumentModeDiff {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const file = createTextDiff({
    oldFile: { path: 'note.ts', text: 'keep\nold\nskip\n', languageId: 'typescript' },
    newFile: { path: 'note.ts', text: 'keep\nnew\nskip\n', languageId: 'typescript' },
  })
  const rows = createStackedProjection(file).rows
  const mounted = createVisibleEditor(host, {
    ...createDiffEditorOptions(),
  })
  mounted.setText(joinRenderLines(rows), { tokens: rowTokens(rows) })
  mounted.setRowDecorations(rowDecorations(rows))

  container = host
  editor = mounted
  return { container: host, editor: mounted, rows }
}

/** One token per non-empty row, standing in for the projected full-file tokens the plugin builds. */
function rowTokens(rows: readonly DiffRenderRow[]): readonly EditorToken[] {
  const tokens: EditorToken[] = []
  let offset = 0
  for (const row of rows) {
    if (row.text.length > 0) {
      tokens.push({
        start: offset,
        end: offset + row.text.length,
        style: { color: 'rgb(1, 2, 3)' },
      })
    }
    offset += row.text.length + 1
  }
  return tokens
}

function rowDecorations(
  rows: readonly DiffRenderRow[],
): ReadonlyMap<number, VirtualizedTextRowDecoration> {
  const decorations = new Map<number, VirtualizedTextRowDecoration>()
  for (const [index, row] of rows.entries()) {
    decorations.set(index, {
      className: `editor-diff-row editor-diff-row-${row.type}`,
      gutterClassName: `editor-diff-gutter-row editor-diff-gutter-row-${row.type}`,
    })
  }
  return decorations
}

function rowStartOffset(
  rows: readonly DiffRenderRow[],
  match: (row: DiffRenderRow) => boolean,
): number {
  let offset = 0
  for (const row of rows) {
    if (match(row)) return offset
    offset += row.text.length + 1
  }
  throw new Error('Expected a matching row')
}

function copyFrom(host: HTMLElement): string {
  const element = host.querySelector<HTMLElement>('.editor')
  if (!element) throw new Error('Expected a mounted editor')

  const transfer = new DataTransfer()
  const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true })
  // happy-dom's ClipboardEvent ignores the `clipboardData` init, so attach the transfer the
  // editor's own handler writes into.
  Object.defineProperty(event, 'clipboardData', { value: transfer })
  element.dispatchEvent(event)
  return transfer.getData('text/plain')
}
