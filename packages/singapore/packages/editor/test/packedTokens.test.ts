import { describe, expect, it } from 'vitest'
import {
  packEditorTokens,
  packedEditorTokenTransfers,
  unpackEditorTokens,
} from '../src/syntax/packedTokens'

describe('packed editor token transport', () => {
  it('shares numeric packing, transfer buffers, and exact ordering metadata', () => {
    const sharedStyle = { color: '#f00' }
    const tokens = [
      { start: 0, end: 10, style: sharedStyle },
      { start: 2, end: 5, style: sharedStyle },
      { start: 11, end: 15, style: { color: '#0f0' } },
    ]

    const packed = packEditorTokens(tokens)

    expect(Array.from(packed.starts)).toEqual([0, 2, 11])
    expect(Array.from(packed.ends)).toEqual([10, 5, 15])
    expect(Array.from(packed.styleIds)).toEqual([0, 0, 1])
    expect(packed.styles).toEqual([{ color: '#f00' }, { color: '#0f0' }])
    expect(packed).toMatchObject({
      monotonicEnd: false,
      nonOverlapping: false,
      sortedByStart: true,
    })
    expect(packedEditorTokenTransfers(packed)).toEqual([
      packed.starts.buffer,
      packed.ends.buffer,
      packed.styleIds.buffer,
    ])

    const unpacked = unpackEditorTokens(packed)
    expect(unpacked).toEqual(tokens)
    expect(unpacked[0]?.style).toBe(unpacked[1]?.style)
  })

  // The failure is a consumer unpacking a whole document to read one row.
  it('unpacks a range without touching the tokens outside it', () => {
    const style = { color: '#f00' }
    const packed = packEditorTokens([
      { start: 0, end: 1, style },
      { start: 2, end: 3, style },
      { start: 4, end: 5, style },
    ])

    expect(unpackEditorTokens(packed, 1, 2)).toEqual([{ start: 2, end: 3, style }])
    expect(unpackEditorTokens(packed, 2, 99)).toEqual([{ start: 4, end: 5, style }])
    expect(unpackEditorTokens(packed, 3)).toEqual([])
  })
})
