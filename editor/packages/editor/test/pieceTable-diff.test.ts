import { describe, expect, it } from 'vitest'

import {
  applyBatchToPieceTable,
  createPieceTableSnapshot,
  deleteFromPieceTable,
  diffPieceTableSnapshots,
  insertIntoPieceTable,
  materializePieceTableFullText,
} from '@singapore-editor/textbuffer'
import type { PieceTableTreeSnapshot } from '@singapore-editor/textbuffer/internal/pieceTableTypes'

// Reference implementation mirroring tree-sitter's createTextDiffEdit; the
// snapshot diff must produce the identical edit shape.
const referenceDiff = (
  previousText: string,
  nextText: string,
): { from: number; to: number; text: string } | null => {
  if (previousText === nextText) return null

  let start = 0
  const maxPrefixLength = Math.min(previousText.length, nextText.length)
  while (start < maxPrefixLength && previousText[start] === nextText[start]) start += 1

  let previousEnd = previousText.length
  let nextEnd = nextText.length
  while (
    previousEnd > start &&
    nextEnd > start &&
    previousText[previousEnd - 1] === nextText[nextEnd - 1]
  ) {
    previousEnd -= 1
    nextEnd -= 1
  }

  return { from: start, to: previousEnd, text: nextText.slice(start, nextEnd) }
}

const expectDiffParity = (previous: PieceTableTreeSnapshot, next: PieceTableTreeSnapshot): void => {
  const previousText = materializePieceTableFullText(previous)
  const nextText = materializePieceTableFullText(next)
  const edit = diffPieceTableSnapshots(previous, next)

  expect(edit).toEqual(referenceDiff(previousText, nextText))
  if (edit) {
    const spliced = previousText.slice(0, edit.from) + edit.text + previousText.slice(edit.to)
    expect(spliced).toBe(nextText)
  }
}

describe('diffPieceTableSnapshots', () => {
  it('returns null for identical snapshots', () => {
    const snapshot = createPieceTableSnapshot('hello world')

    expect(diffPieceTableSnapshots(snapshot, snapshot)).toBeNull()
    expect(diffPieceTableSnapshots(snapshot, createPieceTableSnapshot('hello world'))).toBeNull()

    const empty = createPieceTableSnapshot('')
    expect(diffPieceTableSnapshots(empty, createPieceTableSnapshot(''))).toBeNull()
  })

  it('returns null for snapshots with equal text but different piece layouts', () => {
    const direct = createPieceTableSnapshot('abcdef')
    let pieced = createPieceTableSnapshot('abef')
    pieced = insertIntoPieceTable(pieced, 2, 'cd')

    expect(diffPieceTableSnapshots(direct, pieced)).toBeNull()
  })

  it('detects appends, prepends, and middle replacements', () => {
    const base = createPieceTableSnapshot('hello world')

    expectDiffParity(base, insertIntoPieceTable(base, base.length, '!'))
    expectDiffParity(base, insertIntoPieceTable(base, 0, '>> '))
    expectDiffParity(base, applyBatchToPieceTable(base, [{ from: 6, to: 11, text: 'there' }]))
  })

  it('detects pure inserts, pure deletes, and whole replacements', () => {
    const base = createPieceTableSnapshot('abcdef')

    expectDiffParity(base, insertIntoPieceTable(base, 3, 'XYZ'))
    expectDiffParity(base, deleteFromPieceTable(base, 2, 2))
    expectDiffParity(base, createPieceTableSnapshot('completely different'))
    expectDiffParity(base, createPieceTableSnapshot(''))
    expectDiffParity(createPieceTableSnapshot(''), base)
  })

  it('matches the reference on repeated-content overlaps', () => {
    expectDiffParity(createPieceTableSnapshot('aaaa'), createPieceTableSnapshot('aaa'))
    expectDiffParity(createPieceTableSnapshot('aaa'), createPieceTableSnapshot('aaaa'))
    expectDiffParity(createPieceTableSnapshot('abab'), createPieceTableSnapshot('ab'))
    expectDiffParity(createPieceTableSnapshot('ab'), createPieceTableSnapshot('abab'))
  })

  it('diffs a small edit inside a document larger than the suffix window', () => {
    const big = `${'lorem ipsum dolor sit amet '.repeat(2_000)}tail`
    const previous = createPieceTableSnapshot(big)
    const next = applyBatchToPieceTable(previous, [{ from: 27_000, to: 27_005, text: 'EDIT' }])

    expectDiffParity(previous, next)
  })

  it('diffs snapshots built from divergent edit histories', () => {
    let previous = createPieceTableSnapshot('shared prefix MIDDLE shared suffix')
    previous = insertIntoPieceTable(previous, 14, 'extra ')

    let next = createPieceTableSnapshot('shared prefix MIDDLE shared suffix')
    next = deleteFromPieceTable(next, 14, 7)
    next = insertIntoPieceTable(next, 14, 'CENTER ')

    expectDiffParity(previous, next)
    expectDiffParity(next, previous)
  })
})
