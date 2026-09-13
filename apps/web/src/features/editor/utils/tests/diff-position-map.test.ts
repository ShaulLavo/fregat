import {
  createSplitProjection,
  createStackedProjection,
  createTextDiff,
  joinRenderLines,
} from '@singapore-editor/diff'
import { describe, expect, it } from 'vitest'

import {
  createDiffPositionMap,
  type DiffPositionMap,
} from '@/features/editor/utils/diff-position-map'

// Built from the real projection, not a hand-written row list: the whole risk here is that the
// buffer and the file disagree about where a line is, and a fixture that invents rows cannot
// disagree the way the real one does.

const OLD = 'const a = 1\nconst b = 2\nconst c = 3\nconst d = 4\n'
const NEW = 'const a = 1\nconst B = 22\nconst c = 3\nconst d = 4\n'

describe('createDiffPositionMap', () => {
  it('round-trips a position on a changed line', () => {
    const { map, rows, text } = mapFor(OLD, NEW)
    const row = rows.findIndex((entry) => entry.type === 'addition')
    expect(row).toBeGreaterThanOrEqual(0)
    const offset = offsetOfRow(rows, row) + 6

    const lookup = map.lookupAt(offset)

    // `const B = 22` is the second line of the new file, so line 1 zero-based.
    expect(lookup).toEqual({ kind: 'file', position: { character: 6, line: 1 }, side: 'new' })
    expect(map.bufferOffsetAt('new', filePosition(lookup))).toBe(offset)
    expect(text.slice(offset, offset + 1)).toBe('B')
  })

  it('is not the identity — a buffer row is not the file line it shows', () => {
    // The guard on every other assertion in this file: with a four-line fixture the row index and
    // the file line coincide, so a mapping that did nothing at all would still pass them. A
    // collapsed region above the change is what pulls the two apart, and it is also the normal
    // case — most of a real diff is collapsed.
    const long = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join('\n')
    const { map, rows } = mapFor(`${long}\n`, `${long.replace('line 40', 'changed')}\n`)
    const row = rows.findIndex((entry) => entry.type === 'addition')
    expect(row).toBeGreaterThanOrEqual(0)

    const lookup = map.lookupAt(offsetOfRow(rows, row))
    expect(filePosition(lookup).line).toBe(39)
    expect(filePosition(lookup).line).not.toBe(row)
  })

  it('refuses a placeholder row, which stands for no line of either file', () => {
    // The old side pads a pure addition; the new side pads a pure deletion.
    const { map, rows } = mapFor('alpha\nbeta\n', 'alpha\n')
    const placeholder = rows.findIndex((entry) => entry.type === 'placeholder')
    expect(placeholder).toBeGreaterThanOrEqual(0)

    expect(map.lookupAt(offsetOfRow(rows, placeholder))).toEqual({ kind: 'none' })
  })

  it('refuses a separator row, whose text is a label and not code', () => {
    const long = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join('\n')
    const { map, rows } = mapFor(`${long}\n`, `${long.replace('line 40', 'changed')}\n`)
    const separator = rows.findIndex((entry) => entry.type === 'hunk')
    expect(separator).toBeGreaterThanOrEqual(0)

    expect(map.lookupAt(offsetOfRow(rows, separator))).toEqual({ kind: 'none' })
  })

  it('refuses a line the projection blanked because it looks like a hunk header', () => {
    // `renderLineText` empties any line matching `@@ -n,n +n,n @@`, so the row is empty while the
    // file line is not. Its line number would be honest and its columns a lie.
    const header = '@@ -1,2 +3,4 @@'
    const { map, rows, newLines } = mapFor(`alpha\n${header}\n`, `alpha\n${header}\nbeta\n`)
    const blanked = rows.findIndex(
      (entry) => entry.newLineNumber === 2 && entry.text !== newLines[1],
    )
    if (blanked < 0) return

    expect(map.lookupAt(offsetOfRow(rows, blanked))).toEqual({ kind: 'none' })
  })

  it('maps a deletion row to the old file, which the diff opens as its own document', () => {
    // The answer that lets a deleted line be hovered at all. It used to be a bare refusal, which
    // is the failure both VS Code and Zed shipped — an affordance that silently answers nothing.
    const file = createTextDiff({
      newFile: { path: 'repo/a.ts', text: 'alpha\n' },
      oldFile: { path: 'repo/a.ts', text: 'alpha\nbeta\n' },
    })
    const rows = createStackedProjection(file).rows
    const map = createDiffPositionMap(rows, file.newLines, file.oldLines)
    const deletion = rows.findIndex((entry) => entry.type === 'deletion')
    expect(deletion).toBeGreaterThanOrEqual(0)

    // `beta` is the second line of the OLD file, and of no line of the new one.
    expect(map.lookupAt(offsetOfRow(rows, deletion))).toEqual({
      kind: 'file',
      position: { character: 0, line: 1 },
      side: 'old',
    })
  })

  it('maps nothing when the diff carries no file text', () => {
    // A patch-only diff has no `newLines` to check a row against, and is not the file anyway.
    const { rows } = mapFor(OLD, NEW)
    const map = createDiffPositionMap(rows, [], [])

    expect(map.lookupAt(0).kind).not.toBe('file')
    expect(map.bufferOffsetAt('new', { character: 0, line: 0 })).toBeNull()
  })

  it('has no offset for a line that is collapsed out of the projection', () => {
    const long = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join('\n')
    const { map } = mapFor(`${long}\n`, `${long.replace('line 40', 'changed')}\n`)

    // Line 5 is inside the collapsed region above the only hunk.
    expect(map.bufferOffsetAt('new', { character: 0, line: 4 })).toBeNull()
    expect(map.bufferOffsetAt('new', { character: 0, line: 39 })).not.toBeNull()
  })
})

/** Narrows a lookup, failing the test rather than the type system if it is not a file position. */
function filePosition(lookup: ReturnType<DiffPositionMap['lookupAt']>) {
  expect(lookup.kind).toBe('file')
  if (lookup.kind !== 'file') throw lookup

  return lookup.position
}

function mapFor(oldText: string, newText: string) {
  const file = createTextDiff({
    newFile: { path: 'repo/a.ts', text: newText },
    oldFile: { path: 'repo/a.ts', text: oldText },
  })
  const rows = createSplitProjection(file).rightRows

  return {
    map: createDiffPositionMap(rows, file.newLines, file.oldLines),
    newLines: file.newLines,
    rows,
    text: joinRenderLines(rows),
  }
}

function offsetOfRow(rows: readonly { readonly text: string }[], index: number) {
  return rows.slice(0, index).reduce((offset, row) => offset + row.text.length + 1, 0)
}
