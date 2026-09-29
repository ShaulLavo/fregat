import { describe, expect, it } from 'vitest'
import type { EditorToken } from '@singapore-editor/core/syntax'
import { projectDiffSyntaxTokens } from '../src/diffSyntax'
import type { DiffRenderRow } from '../src/types'

/**
 * `projectDiffSyntaxTokens` reads each row's tokens by bisection on a store instead of scanning
 * every token for every row. The reference below is that full scan, over the order a store holds
 * tokens in; fuzzing the two against each other is what shows the output is identical.
 */
describe('projectDiffSyntaxTokens', () => {
  it('matches a full-scan reference across randomised sources and rows', () => {
    for (let seed = 1; seed <= 400; seed += 1) {
      const random = mulberry(seed)
      const oldLines = randomLines(random)
      const newLines = randomLines(random)
      const sources = [
        {
          lineStarts: lineStartsFor(oldLines),
          side: 'old' as const,
          tokens: randomTokens(random, oldLines),
        },
        {
          lineStarts: lineStartsFor(newLines),
          side: 'new' as const,
          tokens: randomTokens(random, newLines),
        },
      ]
      const rows = randomRows(random, oldLines.length, newLines.length)

      for (const side of ['old', 'new', 'stacked'] as const) {
        expect(
          projectDiffSyntaxTokens({ rows, side, sources }),
          `seed ${seed} side ${side}`,
        ).toEqual(referenceProjection(rows, side, sources))
      }
    }
  })

  it('projects a token that spans a line boundary onto every row it covers', () => {
    // The case a start-keyed bucket would drop: one token running from line 1 into line 2. Both
    // rows must be coloured, each over its own share of the token.
    const lines = ['alpha', 'beta']
    const tokens: EditorToken[] = [{ start: 2, end: 9, style: { color: 'red' } }]
    const rows: DiffRenderRow[] = [
      { type: 'context', text: 'alpha', oldLineNumber: 1, newLineNumber: 1 },
      { type: 'context', text: 'beta', oldLineNumber: 2, newLineNumber: 2 },
    ]

    const projected = projectDiffSyntaxTokens({
      rows,
      side: 'old',
      sources: [{ lineStarts: lineStartsFor(lines), side: 'old', tokens }],
    })

    // 'alpha' occupies 0-5 in the projection, 'beta' 6-10. The token covers 'pha' and 'bet'.
    expect(projected).toEqual([
      { start: 2, end: 5, style: { color: 'red' } },
      { start: 6, end: 9, style: { color: 'red' } },
    ])
  })

  it('is unaffected by the order tokens arrive in', () => {
    // Nothing may assume the stream is sorted: tree-sitter and shiki are separate producers.
    const lines = ['alpha', 'beta', 'gamma']
    const tokens: EditorToken[] = [
      { start: 12, end: 17, style: { color: 'c' } },
      { start: 0, end: 5, style: { color: 'a' } },
      { start: 6, end: 10, style: { color: 'b' } },
    ]
    const rows: DiffRenderRow[] = lines.map((text, index) => ({
      type: 'context',
      text,
      oldLineNumber: index + 1,
      newLineNumber: index + 1,
    }))
    const source = { lineStarts: lineStartsFor(lines), side: 'old' as const }

    const shuffled = projectDiffSyntaxTokens({
      rows,
      side: 'old',
      sources: [{ ...source, tokens }],
    })
    const sorted = projectDiffSyntaxTokens({
      rows,
      side: 'old',
      sources: [{ ...source, tokens: [...tokens].sort((left, right) => left.start - right.start) }],
    })

    expect(shuffled).toEqual(sorted)
    expect(shuffled.map((token) => token.style.color)).toEqual(['a', 'b', 'c'])
  })
})

/** Every row scans the entire token stream, in store order. */
function referenceProjection(
  rows: readonly DiffRenderRow[],
  side: 'old' | 'new' | 'stacked',
  sources: readonly {
    lineStarts: readonly number[]
    side: 'old' | 'new'
    tokens: readonly EditorToken[]
  }[],
): readonly EditorToken[] {
  const projected: EditorToken[] = []
  let rowOffset = 0

  for (const row of rows) {
    const sourceSide = side === 'stacked' ? (row.type === 'deletion' ? 'old' : 'new') : side
    const source = sources.find((candidate) => candidate.side === sourceSide)
    if (!source) {
      rowOffset += row.text.length + 1
      continue
    }

    const lineNumber = sourceSide === 'old' ? row.oldLineNumber : row.newLineNumber
    const lineStart = lineNumber === undefined ? undefined : source.lineStarts[lineNumber - 1]
    if (lineNumber !== undefined && lineStart !== undefined) {
      const nextLineStart = source.lineStarts[lineNumber]
      const lineEnd = Math.min(
        nextLineStart === undefined ? Number.POSITIVE_INFINITY : nextLineStart - 1,
        lineStart + row.text.length,
      )
      for (const token of sortedByStart(source.tokens)) {
        if (token.end <= lineStart) continue
        if (token.start >= lineEnd) continue
        const start = Math.max(token.start, lineStart)
        const end = Math.min(token.end, lineEnd)
        if (end <= start) continue
        projected.push({
          end: rowOffset + end - lineStart,
          start: rowOffset + start - lineStart,
          style: token.style,
        })
      }
    }
    rowOffset += row.text.length + 1
  }

  return projected
}

// A store holds tokens by start, ties in producer order, so that is the order a row reads them in.
function sortedByStart(tokens: readonly EditorToken[]): readonly EditorToken[] {
  return [...tokens].sort((left, right) => left.start - right.start)
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

function randomLines(random: () => number): readonly string[] {
  const count = 1 + Math.floor(random() * 8)
  return Array.from({ length: count }, () => 'x'.repeat(Math.floor(random() * 7)))
}

function lineStartsFor(lines: readonly string[]): readonly number[] {
  const starts: number[] = []
  let offset = 0
  for (const line of lines) {
    starts.push(offset)
    offset += line.length + 1
  }
  return starts
}

function randomTokens(random: () => number, lines: readonly string[]): readonly EditorToken[] {
  const total = lines.join('\n').length
  const count = Math.floor(random() * 10)
  return Array.from({ length: count }, () => {
    // Deliberately unsorted, sometimes degenerate, sometimes spanning line boundaries.
    const start = Math.floor(random() * (total + 2))
    const end = start + Math.floor(random() * 9)
    return { start, end, style: { color: `c${Math.floor(random() * 4)}` } }
  })
}

function randomRows(
  random: () => number,
  oldCount: number,
  newCount: number,
): readonly DiffRenderRow[] {
  const count = 1 + Math.floor(random() * 10)
  return Array.from({ length: count }, () => {
    const roll = random()
    const text = 'y'.repeat(Math.floor(random() * 7))
    if (roll < 0.25) {
      return { type: 'deletion', text, oldLineNumber: 1 + Math.floor(random() * (oldCount + 1)) }
    }
    if (roll < 0.5) {
      return { type: 'addition', text, newLineNumber: 1 + Math.floor(random() * (newCount + 1)) }
    }
    if (roll < 0.65) return { type: 'hunk', text }
    if (roll < 0.75) return { type: 'placeholder', text: '' }
    return {
      type: 'context',
      text,
      oldLineNumber: 1 + Math.floor(random() * (oldCount + 1)),
      newLineNumber: 1 + Math.floor(random() * (newCount + 1)),
    }
  })
}
