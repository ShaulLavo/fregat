import { describe, expect, it } from 'vitest'

import {
  createDocumentLogicalRevisionScope,
  DocumentEditChain,
  type DocumentLogicalRevisionScope,
  type DocumentSyncPoint,
} from '../src/editor/editChain'
import type { TextEdit } from '../src/tokens'

const apply = (text: string, edits: readonly TextEdit[]) => {
  let result = text
  for (const edit of edits.toSorted(
    (left, right) => right.from - left.from || right.to - left.to,
  )) {
    result = result.slice(0, edit.from) + edit.text + result.slice(edit.to)
  }
  return result
}

describe('DocumentEditChain', () => {
  it('composes a workspace transition count with later ordinary edits', () => {
    const chain = new DocumentEditChain(0, 0)
    const scope = createDocumentLogicalRevisionScope()
    const point = chain.point
    record(chain, [{ from: 0, to: 0, text: 'A' }], 3, scope)
    record(chain, [{ from: 1, to: 1, text: 'B' }])

    expect(chain.changesSince(point, scope)).toMatchObject({
      edits: [{ from: 0, to: 0, text: 'AB' }],
      logicalRevisionCount: 4,
      revisionAfter: 2,
    })
  })

  it('retains a workspace transition count across full-sync fallback', () => {
    const chain = new DocumentEditChain(0, 0)
    const scope = createDocumentLogicalRevisionScope()
    const point = chain.point
    record(chain, null, 5, scope)

    expect(chain.changesSince(point, scope)).toMatchObject({
      edits: null,
      logicalRevisionCount: 5,
      revisionAfter: 1,
    })
  })

  it('returns empty edits count zero and the same current DocumentSyncPoint', () => {
    const chain = new DocumentEditChain(0, 0)
    const point = chain.point
    expect(chain.changesSince(point, null)).toEqual({
      edits: [],
      logicalRevisionCount: 0,
      revisionAfter: 0,
      syncPointAfter: point,
    })
  })

  it('returns null for a point from another sync segment', () => {
    const chain = new DocumentEditChain(0, 0)
    const point = chain.point
    record(chain, [{ from: 0, to: 0, text: 'a' }])
    chain.rotate()

    expect(chain.changesSince(point, null)).toBeNull()
  })

  it('composes a typing run into one base edit', () => {
    const base = 'const value = 1'
    const chain = new DocumentEditChain(0, 0)
    const point = chain.point
    record(chain, [{ from: 15, to: 15, text: '2' }])
    record(chain, [{ from: 16, to: 16, text: '3' }])
    record(chain, [{ from: 17, to: 17, text: '4' }])

    const edits = editsSince(chain, point)
    expect(edits).toEqual([{ from: 15, to: 15, text: '234' }])
    expect(apply(base, edits!)).toBe('const value = 1234')
  })

  it('composes typing followed by backspace within the run', () => {
    const chain = new DocumentEditChain(0, 0)
    const point = chain.point
    record(chain, [{ from: 3, to: 3, text: 'x' }])
    record(chain, [{ from: 4, to: 4, text: 'y' }])
    record(chain, [{ from: 4, to: 5, text: '' }])

    expect(apply('abc', editsSince(chain, point)!)).toBe('abcx')
  })

  it('composes multi-cursor batches', () => {
    const base = 'aa bb cc'
    const chain = new DocumentEditChain(0, 0)
    const point = chain.point
    const first = [
      { from: 0, to: 0, text: 'x' },
      { from: 3, to: 3, text: 'y' },
      { from: 6, to: 6, text: 'z' },
    ]
    const second = [
      { from: 1, to: 1, text: 'X' },
      { from: 5, to: 5, text: 'Y' },
      { from: 9, to: 9, text: 'Z' },
    ]
    record(chain, first)
    record(chain, second)

    expect(apply(base, editsSince(chain, point)!)).toBe(apply(apply(base, first), second))
  })

  it.each([
    {
      name: 'overlapping deletions',
      first: { from: 4, to: 6, text: '' },
      second: { from: 2, to: 6, text: '' },
      composed: { from: 2, to: 8, text: '' },
    },
    {
      name: 'left-adjacent deletions',
      first: { from: 4, to: 6, text: '' },
      second: { from: 2, to: 4, text: '' },
      composed: { from: 2, to: 6, text: '' },
    },
    {
      name: 'right-adjacent deletions',
      first: { from: 4, to: 6, text: '' },
      second: { from: 4, to: 6, text: '' },
      composed: { from: 4, to: 8, text: '' },
    },
    {
      name: 'deletion across an insertion boundary',
      first: { from: 5, to: 5, text: 'ab' },
      second: { from: 4, to: 6, text: '' },
      composed: { from: 4, to: 5, text: 'b' },
    },
    {
      name: 'overlapping replacements with a retained prefix',
      first: { from: 2, to: 6, text: 'WXYZ' },
      second: { from: 4, to: 8, text: '!' },
      composed: { from: 2, to: 8, text: 'WX!' },
    },
    {
      name: 'overlapping replacements with a retained suffix',
      first: { from: 4, to: 8, text: 'WXYZ' },
      second: { from: 2, to: 6, text: '!' },
      composed: { from: 2, to: 8, text: '!YZ' },
    },
    {
      name: 'adjacent replacements',
      first: { from: 2, to: 4, text: 'XY' },
      second: { from: 4, to: 6, text: '!' },
      composed: { from: 2, to: 6, text: 'XY!' },
    },
  ])('composes $name', ({ first, second, composed }) => {
    const base = '0123456789'
    const chain = new DocumentEditChain(0, 0)
    const point = chain.point
    record(chain, [first])
    record(chain, [second])

    const edits = editsSince(chain, point)
    expect(edits).toEqual([composed])
    expect(apply(base, edits!)).toBe(apply(apply(base, [first]), [second]))
  })

  it('composes a batch straddling several earlier replacements', () => {
    const base = '0123456789abcdef'
    const first = [
      { from: 2, to: 4, text: 'XY' },
      { from: 6, to: 8, text: '' },
      { from: 10, to: 12, text: 'ABCD' },
    ]
    const second = [
      { from: 1, to: 3, text: '!' },
      { from: 4, to: 10, text: '?' },
      { from: 12, to: 14, text: '#' },
    ]
    const chain = new DocumentEditChain(0, 0)
    const point = chain.point
    record(chain, first)
    record(chain, second)

    const edits = editsSince(chain, point)
    expect(edits).not.toBeNull()
    expect(apply(base, edits!)).toBe(apply(apply(base, first), second))
  })

  it('applies a replacement before insertions at the same batch offset', () => {
    const chain = new DocumentEditChain()
    const point = chain.point
    record(chain, [
      { from: 2, to: 2, text: 'I' },
      { from: 2, to: 4, text: 'R' },
    ])

    const edits = editsSince(chain, point)
    expect(edits).toEqual([{ from: 2, to: 4, text: 'IR' }])
    expect(apply('012345', edits!)).toBe('01IR45')
  })

  it('preserves the input order of equal-offset insertions', () => {
    const chain = new DocumentEditChain()
    const point = chain.point
    record(chain, [
      { from: 2, to: 2, text: 'A' },
      { from: 2, to: 2, text: 'B' },
    ])

    expect(editsSince(chain, point)).toEqual([{ from: 2, to: 2, text: 'BA' }])
  })

  it('retains exactly 128 edits of history', () => {
    const chain = new DocumentEditChain(0, 0)
    const expired = chain.point
    record(chain, [{ from: 0, to: 0, text: 'x' }])
    const retained = chain.point
    for (let step = 0; step < 128; step += 1) {
      record(chain, [{ from: step + 1, to: step + 1, text: 'x' }])
    }

    expect(chain.changesSince(expired, null)).toBeNull()
    expect(editsSince(chain, retained)).toEqual([{ from: 1, to: 1, text: 'x'.repeat(128) }])
  })

  it('maps every source position like sequential random edits', () => {
    const random = seededRandom(0xc0ffee)
    for (let round = 0; round < 300; round += 1) {
      expectRandomEditsToMapPositions(random)
    }
  })

  it('maps every boundary like sequential random deletions', () => {
    const random = seededRandom(0xdecaf)
    for (let round = 0; round < 200; round += 1) {
      expectRandomDeletionsToMapBoundaries(random)
    }
  })

  it('matches sequential application across random typing-like sequences', () => {
    expectRandomTypingSequencesToCompose()
  })
})

function expectRandomTypingSequencesToCompose(): void {
  const random = seededRandom(0x1234)
  for (let round = 0; round < 200; round += 1) {
    expectRandomTypingSequenceToCompose(random)
  }
}

function expectRandomTypingSequenceToCompose(random: () => number): void {
  let text = 'function example(alpha, beta) { return alpha + beta }'
  const base = text
  const chain = new DocumentEditChain(0, 0)
  const point = chain.point

  for (let step = 0; step < 8; step += 1) {
    const insert = random() < 0.7 || text.length === 0
    const from = Math.floor(random() * (text.length + Number(insert)))
    const edit = {
      from,
      to: insert ? from : Math.min(text.length, from + 1 + Math.floor(random() * 2)),
      text: insert ? 'xyz'[Math.floor(random() * 3)]! : '',
    }
    text = apply(text, [edit])
    record(chain, [edit])
  }

  const edits = editsSince(chain, point)
  expect(edits).not.toBeNull()
  expect(apply(base, edits!)).toBe(text)
}

function expectRandomDeletionsToMapBoundaries(random: () => number): void {
  const base = '0123456789abcdef'
  let text = base
  let positions = Array.from({ length: base.length + 1 }, (_, offset) => offset)
  const chain = new DocumentEditChain(0, 0)
  const point = chain.point
  for (let step = 0; step < 12; step += 1) {
    const from = Math.floor(random() * (text.length + 1))
    const to = from + Math.floor(random() * (text.length - from + 1))
    const edit = { from, to, text: '' }
    positions = positions.map((offset) => mapDeletedPosition(offset, [edit]))
    text = apply(text, [edit])
    record(chain, [edit])

    const edits = editsSince(chain, point)
    expect(edits).not.toBeNull()
    expect(apply(base, edits!)).toBe(text)
    expect(positions).toEqual(positions.map((_, offset) => mapDeletedPosition(offset, edits!)))
  }
}

function mapDeletedPosition(offset: number, edits: readonly TextEdit[]): number {
  let delta = 0
  for (const edit of edits) {
    if (offset < edit.from) break
    if (offset <= edit.to) return edit.from + delta
    delta -= edit.to - edit.from
  }
  return offset + delta
}

function expectRandomEditsToMapPositions(random: () => number): void {
  const base = '0123456789abcdef'
  let text = base
  const positions: (number | null)[] = Array.from(
    { length: base.length + 1 },
    (_, offset) => offset,
  )
  const chain = new DocumentEditChain(0, 0)
  const points = [chain.point]
  const batches: TextEdit[][] = []

  for (let step = 0; step < 16; step += 1) {
    const batch: TextEdit[] = []
    let cursor = 0
    const count = 1 + Math.floor(random() * 3)
    for (let index = 0; index < count && cursor <= text.length; index += 1) {
      const from = cursor + Math.floor(random() * (text.length - cursor + 1))
      const to = from + Math.floor(random() * (text.length - from + 1))
      batch.push({ from, to, text: 'XYZ'.slice(0, Math.floor(random() * 4)) })
      cursor = to + Math.floor(random() * 2)
    }
    for (let offset = 0; offset < positions.length; offset += 1) {
      positions[offset] = mapSourcePosition(positions[offset]!, batch)
    }
    batches.push(batch)
    text = apply(text, batch)
    record(chain, batch)
    points.push(chain.point)

    const edits = editsSince(chain, points[0]!)
    expect(edits).not.toBeNull()
    expect(apply(base, edits!)).toBe(text)
    expect(positions).toEqual(positions.map((_, offset) => mapSourcePosition(offset, edits!)))
  }

  for (let start = 1; start < batches.length; start += 1) {
    const source = batches.slice(0, start).reduce(apply, base)
    const edits = editsSince(chain, points[start]!)
    expect(edits).not.toBeNull()
    expect(apply(source, edits!)).toBe(text)
    for (let offset = 0; offset <= source.length; offset += 1) {
      const sequential = batches.slice(start).reduce<number | null>(mapSourcePosition, offset)
      expect(mapSourcePosition(offset, edits!)).toBe(sequential)
    }
  }
}

// Positions identify source characters. A replacement invalidates the characters it removes.
function mapSourcePosition(offset: number | null, edits: readonly TextEdit[]): number | null {
  if (offset === null) return null
  let delta = 0
  for (const edit of edits.toSorted((left, right) => left.from - right.from)) {
    if (edit.from <= offset && offset < edit.to) return null
    if (edit.to <= offset) delta += edit.text.length - (edit.to - edit.from)
  }
  return offset + delta
}

function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function record(
  chain: DocumentEditChain,
  edits: readonly TextEdit[] | null,
  logicalRevisionCount = 1,
  logicalRevisionScope: DocumentLogicalRevisionScope | null = null,
): void {
  const point = chain.point
  chain.record({
    edits,
    logicalRevisionCount,
    logicalRevisionScope,
    revisionAfter: point.revision + 1,
    revisionBefore: point.revision,
    textChanged: true,
  })
}

function editsSince(
  chain: DocumentEditChain,
  point: DocumentSyncPoint,
): readonly TextEdit[] | null {
  return chain.changesSince(point, null)?.edits ?? null
}
