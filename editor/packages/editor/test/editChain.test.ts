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
  for (const edit of edits.toSorted((left, right) => right.from - left.from)) {
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

  it('falls back when a later edit straddles a previous edit boundary', () => {
    const chain = new DocumentEditChain(0, 0)
    const point = chain.point
    record(chain, [{ from: 5, to: 5, text: 'ab' }])
    record(chain, [{ from: 4, to: 6, text: '' }])
    expect(editsSince(chain, point)).toBeNull()
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
  if (!edits) return
  expect(apply(base, edits)).toBe(text)
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
