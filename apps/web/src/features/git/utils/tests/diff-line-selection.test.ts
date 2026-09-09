import { createDiffPlugin } from '@singapor/diff'

import {
  diffLineAddress,
  diffLineAddressLabel,
  diffLineSelectionText,
  diffPaneRows,
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
  const oldRows = diffPaneRows(file, 'old', new Set())
  const newRows = diffPaneRows(file, 'new', new Set())
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
  const rows = diffPaneRows(file, 'stacked', new Set())

  const address = diffLineAddress(selectedDiffRows(rows, 0, rows.length - 1))

  expect(address).toEqual({ newRange: { end: 5, start: 1 }, oldRange: { end: 5, start: 1 } })
  expect(diffLineAddressLabel(address!)).toBe('new lines 1-5, old lines 1-5')
})

test('an address from one pane resolves to both sides and then holds still', () => {
  const file = textDiffFile(OLD_TEXT, NEW_TEXT)
  const stackedRows = diffPaneRows(file, 'stacked', new Set())
  const dragged = diffLineAddress(selectedDiffRows(diffPaneRows(file, 'new', new Set()), 0, 2))!

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
  const oldRows = diffPaneRows(file, 'old', new Set())
  const deletion = oldRows.findIndex((row) => row.type === 'deletion')
  const address = diffLineAddress(selectedDiffRows(oldRows, deletion, deletion))!

  const resolved = diffRowsForAddress(diffPaneRows(file, 'stacked', new Set()), address)

  expect(resolved.map((row) => row.text)).toEqual(['beta'])
  expect(diffLineAddress(resolved)).toEqual(address)
})

test('the attached text carries the path, both sides and the selected lines', () => {
  const file = textDiffFile(OLD_TEXT, NEW_TEXT)
  const rows = diffPaneRows(file, 'stacked', new Set())
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
  const rows = diffPaneRows(file, 'stacked', new Set())
  const address = diffLineAddress(selectedDiffRows(rows, 0, rows.length - 1))!

  const text = diffLineSelectionText(file.path, address, diffRowsForAddress(rows, address))

  expect(text).toContain('````diff')
  expect(text.endsWith('\n````')).toBe(true)
})

test('the projection follows the expansion the plugin owns, and only that', () => {
  const file = textDiffFile(numberedText(), numberedText({ 2: 'two changed', 35: 'thirty five' }))
  const plugin = createDiffPlugin({ mode: 'document', side: 'new', syntaxHighlight: false })
  plugin.setFile(file)
  const collapsed = plugin.getRows()
  const separator = collapsed.findIndex((row) => row.type === 'hunk' && row.expandable)
  expect(separator).toBeGreaterThan(0)

  plugin.toggleRegion(collapsed[separator]!.expandKey!)
  const rows = plugin.getRows()

  // The projection built here is the one the pane is showing, because it is
  // built from the plugin's own expansion set rather than a copy of it.
  expect(diffPaneRows(file, 'new', plugin.getExpandedRegions())).toEqual(rows)
  expect(rows.length).toBeGreaterThan(collapsed.length)
  // The row just past the separator is a different line once the skipped range
  // is spliced in. Reading it off the collapsed projection is the silent
  // wrong-line failure that sharing the expansion state prevents.
  const probe = separator + 1
  expect(diffLineAddress(selectedDiffRows(rows, probe, probe))).not.toEqual(
    diffLineAddress(selectedDiffRows(collapsed, probe, probe)),
  )
  // Toggling the same region back off returns the projection to where it was.
  plugin.toggleRegion(collapsed[separator]!.expandKey!)
  expect(plugin.getExpandedRegions().size).toBe(0)
  expect(diffPaneRows(file, 'new', plugin.getExpandedRegions())).toEqual(collapsed)
})

test('rows that stand for no line on either side never enter a selection', () => {
  const file = textDiffFile('alpha\n', 'alpha\nbeta\n')
  const oldRows = diffPaneRows(file, 'old', new Set())

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

function numberedText(replacements: Record<number, string> = {}) {
  return `${Array.from({ length: 40 }, (_, index) => replacements[index + 1] ?? `line ${index + 1}`).join('\n')}\n`
}
