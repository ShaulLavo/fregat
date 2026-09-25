import { createStackedProjection, createSplitProjection } from '@singapore-editor/diff'

import {
  diffLineAddress,
  diffLineAddressLabel,
  diffLineSelectionText,
  diffRowsForAddress,
  selectedDiffRows,
} from '@/features/git/utils/diff-line-selection'
import { editorDiffFiles } from '@workspace/client-core/git/diff-files'
import { gitFileDiff } from '../../../../../test/factories/git-diff'
import { expect, test } from '../../../../../test/fixtures'

// Built through `editorDiffFiles` from the blob-diff shape the git panel opens,
// so these are the same hunks the diff view projects — not a parallel model.

const OLD_TEXT = 'alpha\nbeta\ngamma\ndelta\nepsilon\n'
const NEW_TEXT = 'alpha\nbeta changed\ngamma\ndelta\nepsilon\n'

test('the same visual row addresses the old side in one pane and the new side in the other', () => {
  const file = textDiffFile(OLD_TEXT, NEW_TEXT)
  const oldRows = createSplitProjection(file).leftRows
  const newRows = createSplitProjection(file).rightRows
  const changed = oldRows.findIndex((row) => row.type === 'deletion')

  const fromOldPane = diffLineAddress(selectedDiffRows(oldRows, changed, changed))
  const fromNewPane = diffLineAddress(selectedDiffRows(newRows, changed, changed))

  // Identical row index, opposite sides — the ambiguity the address exists for.
  expect(fromOldPane).toEqual({ newRange: null, oldRange: { end: 2, start: 2 } })
  expect(fromNewPane).toEqual({ newRange: { end: 2, start: 2 }, oldRange: null })
  expect(diffLineAddressLabel(fromOldPane!)).toBe('old line 2')
  expect(diffLineAddressLabel(fromNewPane!)).toBe('new line 2')
})

test('a stacked selection over a replacement names both sides', () => {
  const file = textDiffFile(OLD_TEXT, NEW_TEXT)
  const rows = createStackedProjection(file).rows

  const address = diffLineAddress(selectedDiffRows(rows, 0, rows.length - 1))

  expect(address).toEqual({ newRange: { end: 5, start: 1 }, oldRange: { end: 5, start: 1 } })
  expect(diffLineAddressLabel(address!)).toBe('new lines 1-5, old lines 1-5')
})

test('an address from one pane resolves to both sides and then holds still', () => {
  const file = textDiffFile(OLD_TEXT, NEW_TEXT)
  const stackedRows = createStackedProjection(file).rows
  const dragged = diffLineAddress(selectedDiffRows(createSplitProjection(file).rightRows, 0, 2))!

  // A drag through the new pane can only name new lines.
  expect(dragged).toEqual({ newRange: { end: 3, start: 1 }, oldRange: null })

  const canonical = diffLineAddress(diffRowsForAddress(stackedRows, dragged))!
  const resolved = diffRowsForAddress(stackedRows, canonical)

  expect(canonical).toEqual({ newRange: { end: 3, start: 1 }, oldRange: { end: 3, start: 1 } })
  expect(resolved.map((row) => row.text)).toEqual(['alpha', 'beta', 'beta changed', 'gamma'])
  // The round trip the whole address exists for: resolving a settled address and
  // re-reading it lands back on the same address.
  expect(diffLineAddress(resolved)).toEqual(canonical)
})

test('a deletion-only address never claims a new-side line', () => {
  const file = textDiffFile(OLD_TEXT, NEW_TEXT)
  const oldRows = createSplitProjection(file).leftRows
  const deletion = oldRows.findIndex((row) => row.type === 'deletion')
  const address = diffLineAddress(selectedDiffRows(oldRows, deletion, deletion))!

  const resolved = diffRowsForAddress(createStackedProjection(file).rows, address)

  expect(resolved.map((row) => row.text)).toEqual(['beta'])
  expect(diffLineAddress(resolved)).toEqual(address)
})

test('the attached text carries the path, both sides and the selected lines', () => {
  const file = textDiffFile(OLD_TEXT, NEW_TEXT)
  const rows = createStackedProjection(file).rows
  const address = diffLineAddress(selectedDiffRows(rows, 0, rows.length - 1))!

  const text = diffLineSelectionText(file.path, address, diffRowsForAddress(rows, address))

  expect(text).toBe(
    [
      'About `repo/a.ts`, new lines 1-5, old lines 1-5:',
      '',
      '```diff',
      '@@ -1,5 +1,5 @@',
      ' alpha',
      '-beta',
      '+beta changed',
      ' gamma',
      ' delta',
      ' epsilon',
      '```',
    ].join('\n'),
  )
})

test('a selected line that contains a fence gets an outer fence that outruns it', () => {
  const file = textDiffFile('const md = ""\n', 'const md = "```ts"\n')
  const rows = createStackedProjection(file).rows
  const address = diffLineAddress(selectedDiffRows(rows, 0, rows.length - 1))!

  const text = diffLineSelectionText(file.path, address, diffRowsForAddress(rows, address))

  expect(text).toContain('````diff')
  expect(text.endsWith('\n````')).toBe(true)
})

test('rows that stand for no line on either side never enter a selection', () => {
  const file = textDiffFile('alpha\n', 'alpha\nbeta\n')
  const oldRows = createSplitProjection(file).leftRows

  // The old pane pads an addition with a placeholder; it addresses nothing.
  expect(oldRows.some((row) => row.type === 'placeholder')).toBe(true)
  expect(
    selectedDiffRows(oldRows, 0, oldRows.length - 1).every((row) => row.type !== 'placeholder'),
  ).toBe(true)
})

function textDiffFile(oldText: string, newText: string) {
  const [file] = editorDiffFiles([{ ...gitFileDiff({ path: 'repo/a.ts' }), newText, oldText }])
  expect(file).toBeDefined()

  return file!
}
