import type { TextEdit } from '@singapore-editor/core/document'
import { expect, it } from 'vitest'
import { documentSummaryPayload } from '../src/summary'
import { createDocumentHarness } from './documentHarness'

it.each(Array.from({ length: 80 }, (_, index) => index + 1))(
  'matches fresh summaries after mixed canonical edits, undo and redo with seed %d',
  async (seed) => {
    const texts = ['', 'AAAAAAAAAA\nZ\nC', 'one\ntwo\nthree\n', '😀\né\n中']
    const fixture = createDocumentHarness(texts[seed % texts.length]!)
    const randomIndex = seededIndex(seed)
    const verify = async () => {
      await fixture.current()
      expect(fixture.worker.document).toMatchObject(
        documentSummaryPayload(fixture.buffer.getTextSnapshot(), 16),
      )
    }
    try {
      await verify()
      for (let round = 0; round < 12; round++) {
        const queued = round % 2 === 0
        const count = randomIndex(4) + 1
        let undoCount = 0
        for (let edit = 0; edit < count; edit++) {
          const change = fixture.view.applyEdits([
            randomEdit(fixture.buffer.getTextSnapshot().length, randomIndex),
          ])
          if (change.kind === 'edit') undoCount++
          if (!queued) await verify()
        }
        if (queued) await verify()
        for (let undo = 0; undo < undoCount; undo++) {
          fixture.view.undo()
          if (!queued) await verify()
        }
        if (queued && undoCount > 0) await verify()
        for (let redo = 0; redo < undoCount; redo++) {
          fixture.view.redo()
          if (!queued) await verify()
        }
        if (queued && undoCount > 0) await verify()
      }
    } finally {
      fixture.dispose()
    }
  },
)

it('encodes a canonical batch with a large prefix insertion and far replacement', async () => {
  const fixture = createDocumentHarness('abc\n'.repeat(20_000))
  try {
    await fixture.current()
    fixture.view.applyEdits([
      { from: 1, to: 1, text: 'x'.repeat(60_000) },
      { from: 60_001, to: 60_002, text: 'Y' },
    ])
    await fixture.current()
    expect(fixture.worker.document.lines[15_000]).toEqual({ text: 'aYc', length: 3 })
    expect(fixture.worker.document).toMatchObject(
      documentSummaryPayload(fixture.buffer.getTextSnapshot(), 16),
    )
  } finally {
    fixture.dispose()
  }
})

it('clips a million-unit line and transfers one changed-line patch for a sparse edit', async () => {
  const fixture = createDocumentHarness(`${'x'.repeat(1_000_000)}\n${'ab\n'.repeat(20_000)}`)
  try {
    await fixture.current()
    const initial = fixture.worker.requests.find((request) => request.type === 'projectSource')
    expect(initial?.projection.kind).toBe('reset')
    if (initial?.projection.kind !== 'reset') expect.unreachable('Reset summary is required')
    expect(initial.projection.summary.lines[0]).toEqual({ text: 'x'.repeat(16), length: 1_000_000 })
    fixture.view.applyEdits([{ from: 1_030_002, to: 1_030_002, text: 'X' }])
    await fixture.current()
    const patch = fixture.worker.requests.findLast((request) => request.type === 'projectSource')
    if (patch?.projection.kind !== 'patch') expect.unreachable('Sparse summary patch is required')
    expect(patch.projection.summary.lines).toEqual([{ text: 'aXb', length: 3 }])
    expect(patch.projection.summary.lineStarts).toBeUndefined()
  } finally {
    fixture.dispose()
  }
})

function seededIndex(seed: number): (length: number) => number {
  let state = seed
  return (length) => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) % length
  }
}

function randomEdit(length: number, randomIndex: (length: number) => number): TextEdit {
  const operation = randomIndex(3)
  const first = randomIndex(length + 1)
  const second = operation === 0 ? first : randomIndex(length + 1)
  const texts = ['x', 'q', '中', '😀', 'é', '\n', 'x\ny\n', '\r\n', '']
  return {
    from: Math.min(first, second),
    to: Math.max(first, second),
    text: operation === 1 ? '' : texts[randomIndex(texts.length)]!,
  }
}
