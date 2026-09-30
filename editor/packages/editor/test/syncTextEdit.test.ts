import { describe, expect, it, vi } from 'vitest'

import { createDocumentSession } from '../src/public/document'
import { syncTextEdit } from '../src/editor/textEdits'

/** A source split into many pieces, so the comparison crosses piece and window boundaries. */
function fragmented(text: string) {
  const session = createDocumentSession(text.slice(0, 1_000))
  for (let at = 1_000; at < text.length; at += 7_001) {
    session.applyEdits([{ from: at, to: at, text: text.slice(at, at + 7_001) }])
  }
  return session.getTextSnapshot()
}

describe('syncTextEdit over a read source', () => {
  const base = 'abcdefghij\n'.repeat(12_000)

  it('is empty for equal text and reads in bounded windows', () => {
    const source = fragmented(base)
    const readRange = vi.spyOn(source, 'readRange')

    expect(syncTextEdit(source, base)).toEqual({ from: base.length, to: base.length, text: '' })
    const reads = readRange.mock.calls.map(([start, end]) => end - start)
    expect(Math.max(...reads)).toBeLessThanOrEqual(16_384)
    expect(reads.reduce((sum, length) => sum + length, 0)).toBe(base.length)
  })

  it('replaces only the differing middle, reading at most two passes', () => {
    const source = fragmented(base)
    const readRange = vi.spyOn(source, 'readRange')
    const middle = 60_000
    const next = `${base.slice(0, middle)}CHANGED${base.slice(middle + 3)}`

    expect(syncTextEdit(source, next)).toEqual({ from: middle, to: middle + 3, text: 'CHANGED' })
    const units = readRange.mock.calls.reduce((sum, [start, end]) => sum + end - start, 0)
    expect(units).toBeLessThanOrEqual(2 * base.length)
  })

  it('keeps prefix and suffix apart when the text only grows or shrinks at one end', () => {
    const source = fragmented('aaaa')

    expect(syncTextEdit(source, 'aaaaaa')).toEqual({ from: 4, to: 4, text: 'aa' })
    expect(syncTextEdit(source, 'aa')).toEqual({ from: 2, to: 4, text: '' })
    expect(syncTextEdit(fragmented(''), 'new')).toEqual({ from: 0, to: 0, text: 'new' })
  })
})
