import { describe, expect, it } from 'vitest'

import {
  applyBatchToPieceTable,
  createPieceTableSnapshot,
  materializePieceTableFullText,
} from '@singapore-editor/core/document'
import {
  createTreeSitterSourceDescriptor,
  readTreeSitterInputRange,
  resolveTreeSitterSourceDescriptor,
  type TreeSitterSourceCache,
} from '../src/treeSitter/source.ts'

// One 16KB source chunk is the unit the descriptor splits on, so the text has
// to span several of them for boundary reads to mean anything.
const UNIT = 'const 名前 = "emoji 🎉🚀 tail"; // ünïcødé\n'
const TEXT = UNIT.repeat(2_000)

const resolve = (text: string) => {
  const snapshot = createPieceTableSnapshot(text)
  const descriptor = createTreeSitterSourceDescriptor(snapshot)
  const cache: TreeSitterSourceCache = new Map()
  return { descriptor, input: resolveTreeSitterSourceDescriptor(cache, 'doc', descriptor) }
}

describe('source chunks', () => {
  it('reads back an edited document across many chunks', () => {
    const middle = Math.floor(TEXT.length / 2)
    const snapshot = applyBatchToPieceTable(createPieceTableSnapshot(TEXT), [
      { from: middle, to: middle, text: 'INSERTED🌍' },
    ])
    const descriptor = createTreeSitterSourceDescriptor(snapshot)
    const input = resolveTreeSitterSourceDescriptor(new Map(), 'doc', descriptor)

    expect(descriptor.chunks.length).toBeGreaterThan(1)
    expect(readTreeSitterInputRange(input, 0, descriptor.length)).toBe(
      materializePieceTableFullText(snapshot),
    )
  })

  it('reads ranges that cross chunk boundaries', () => {
    const { descriptor, input } = resolve(TEXT)
    const expected = TEXT.slice(0, descriptor.length)
    for (const [start, end] of [
      [0, 10],
      [16_380, 16_400],
      [100, 50_000],
      [descriptor.length - 5, descriptor.length],
    ]) {
      expect(readTreeSitterInputRange(input, start!, end!)).toBe(expected.slice(start, end))
    }
  })

  it('keeps a surrogate pair split by a chunk boundary', () => {
    const text = `${'a'.repeat(16 * 1024 - 1)}🎉${'b'.repeat(64)}`
    const { descriptor, input } = resolve(text)

    expect(readTreeSitterInputRange(input, 0, descriptor.length)).toBe(text)
  })

  it('preserves U+FEFF at a chunk boundary', () => {
    const text = `${'a'.repeat(16 * 1024)}﻿tail`
    const { descriptor, input } = resolve(text)

    expect(readTreeSitterInputRange(input, 0, descriptor.length)).toBe(text)
  })
})
