import { describe, expect, it } from 'vitest'
import { createLiveDiffProjection, createTextDiff } from '../src'
import type { DiffFile } from '../src'

/**
 * `overlay` mode is what the example app mounts and the only mode reachable in a running product
 * today, yet almost all of this package's coverage is for `document` mode. This closes the gap on
 * the part that became load-bearing in this branch: `rowsByBufferRow`.
 *
 * The overlay gutter used to resolve a row as `projectionRows[bufferRow]`, which is wrong because
 * the projection interleaves injected deletion rows — every row below the first deletion showed
 * another row's numbers. Resolution now goes through `rowsByBufferRow`, so its invariants stop
 * being an implementation detail and become the thing correctness rests on.
 *
 * Note what is deliberately *not* asserted: that every buffer line has an entry. A whole-file
 * deletion leaves a one-line empty buffer with no new-side row, so no entry is correct there and
 * the gutter cell hides. An earlier over-strict version of this assertion reported 162 false
 * failures on exactly that case.
 */
describe('live projection invariants', () => {
  const boundaries: readonly (readonly [string, string, string])[] = [
    ['deletion at file start', 'gone\na\nb\n', 'a\nb\n'],
    ['deletion at file end', 'a\nb\ngone\n', 'a\nb\n'],
    ['every line deleted', 'a\nb\nc\n', ''],
    ['old one line, new empty', 'only\n', ''],
    ['old empty, new populated', '', 'a\nb\n'],
    ['both empty', '', ''],
    ['first and last deleted', 'x\na\nb\ny\n', 'a\nb\n'],
    ['whole file replaced', 'a\nb\n', 'c\nd\n'],
    ['no trailing newline', 'a\nb', 'a\nB'],
    ['consecutive deletions', 'a\nx\ny\nb\n', 'a\nb\n'],
    ['delete then add at one spot', 'a\nold\nb\n', 'a\nnew\nb\n'],
    ['single line changed', 'a\n', 'b\n'],
  ]

  for (const [name, oldText, newText] of boundaries) {
    it(`holds its invariants: ${name}`, () => {
      expectProjectionInvariants(textDiff(oldText, newText), newText)
    })
  }

  it('holds them across randomised old/new pairs', () => {
    for (let seed = 1; seed <= 1500; seed += 1) {
      const random = mulberry(seed)
      // Biased towards an empty new file, the degenerate case that broke the first fuzz attempt.
      const newText = random() < 0.15 ? '' : randomText(random)
      const oldText = randomText(random)
      expectProjectionInvariants(textDiff(oldText, newText), newText, `seed ${seed}`)
    }
  })
})

function expectProjectionInvariants(file: DiffFile, newText: string, label = ''): void {
  const projection = createLiveDiffProjection(file)
  const bufferLines = newText.split('\n')
  const context = label ? ` (${label})` : ''

  const ids = projection.injectedRows.map((row) => row.id)
  expect(new Set(ids).size, `duplicate injected ids${context}`).toBe(ids.length)
  expect(
    ids.every((id) => typeof id === 'string' && id.length > 0),
    `empty injected id${context}`,
  ).toBe(true)

  for (const row of projection.injectedRows) {
    expect(row.anchorBufferRow, `anchor below range${context}`).toBeGreaterThanOrEqual(0)
    expect(row.anchorBufferRow, `anchor above range${context}`).toBeLessThan(bufferLines.length)
    // A deletion row shows a line that left the new side, so it must have come from the old one.
    expect(file.oldLines.includes(row.text), `injected text not in old file${context}`).toBe(true)
  }

  for (const [bufferRow, row] of projection.rowsByBufferRow) {
    expect(bufferRow, `mapped row below range${context}`).toBeGreaterThanOrEqual(0)
    expect(bufferRow, `mapped row above range${context}`).toBeLessThan(bufferLines.length)
    // The whole point of the map: what it returns for a buffer row is that buffer row.
    expect(row.text, `mapped row text mismatch at ${bufferRow}${context}`).toBe(
      bufferLines[bufferRow],
    )
    expect(row.newLineNumber, `mapped row line number at ${bufferRow}${context}`).toBe(
      bufferRow + 1,
    )
  }

  for (const bufferRow of projection.rowDecorations.keys()) {
    expect(bufferRow, `decoration below range${context}`).toBeGreaterThanOrEqual(0)
    expect(bufferRow, `decoration above range${context}`).toBeLessThan(bufferLines.length)
  }
}

function textDiff(oldText: string, newText: string): DiffFile {
  return createTextDiff({
    oldFile: { path: 'note.txt', text: oldText },
    newFile: { path: 'note.txt', text: newText },
  })
}

function randomText(random: () => number): string {
  const count = Math.floor(random() * 11)
  const alphabet = ['a', 'b', 'c', '', '\t', '  ', 'longer line']
  return Array.from(
    { length: count },
    () => alphabet[Math.floor(random() * alphabet.length)]!,
  ).join('\n')
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
