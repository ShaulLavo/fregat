import { describe, expect, it } from 'vitest'
import type { EditorMinimapDecoration } from '@singapore-editor/core/extensions'
import { mergeDenseDecorations, MINIMAP_DECORATION_MERGE_LIMIT } from '../src/decorationMerge'

const MATCH_COLOR = 'rgba(234, 179, 8, 0.34)'
const ERROR_COLOR = 'rgba(248, 113, 113, 1)'

describe('mergeDenseDecorations', () => {
  it('hands a source at the merge limit straight through', () => {
    const bands = rowBands(1, MINIMAP_DECORATION_MERGE_LIMIT, 1, MATCH_COLOR)

    expect(mergeDenseDecorations(bands, 600, 3000)).toBe(bands)
  })

  it('collapses rows a band apart and leaves rows further apart alone', () => {
    // 600px over 11,000 lines puts 55 lines inside one band: the run of single
    // rows is one band, the stragglers 100 lines apart are still their own.
    const stragglers = [1100, 1200, 1300, 1400, 1500]
    const bands = rowBands(1, 1000, 1, MATCH_COLOR).concat(
      stragglers.map((row) => rowBand(row, MATCH_COLOR)),
    )

    expect(mergeDenseDecorations(bands, 600, 11_000).map(span)).toEqual([
      [1, 1000],
      ...stragglers.map((row) => [row, row]),
    ])
  })

  it('merges each appearance on its own', () => {
    const bands = rowBands(1, 1001, 1, MATCH_COLOR).concat(rowBands(1, 1001, 1, ERROR_COLOR))

    expect(mergeDenseDecorations(bands, 600, 3000)).toEqual([
      { ...rowBand(1, MATCH_COLOR), endLineNumber: 1001 },
      { ...rowBand(1, ERROR_COLOR), endLineNumber: 1001 },
    ])
  })

  it('merges every row together when there is no height to spread them over', () => {
    const bands = rowBands(1, 1001, 3, MATCH_COLOR)

    expect(mergeDenseDecorations(bands, 0, 3001).map(span)).toEqual([[1, 3001]])
  })
})

function rowBands(
  firstRow: number,
  count: number,
  step: number,
  color: string,
): readonly EditorMinimapDecoration[] {
  return Array.from({ length: count }, (_unused, index) => rowBand(firstRow + index * step, color))
}

function rowBand(row: number, color: string): EditorMinimapDecoration {
  return {
    startLineNumber: row,
    startColumn: 1,
    endLineNumber: row,
    endColumn: 1,
    color,
    position: 'inline',
  }
}

function span(decoration: EditorMinimapDecoration): readonly number[] {
  return [decoration.startLineNumber, decoration.endLineNumber]
}
