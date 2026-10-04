import { describe, expect, it } from 'vitest'
import { EditorTokenStore } from '../src/syntax/tokenStore'

const styles = [{ color: '#fff' }]
const emptyRun = { starts: new Uint32Array(), ends: new Uint32Array(), styleIds: new Uint32Array() }

describe('token store retention', () => {
  it('charges a whole backing once for offset and overlapping views across stores', () => {
    const backing = new ArrayBuffer(4096)
    const first = EditorTokenStore.fromPacked({
      starts: new Uint32Array(backing, 8, 2),
      ends: new Uint32Array(backing, 12, 2),
      styleIds: new Uint32Array(backing, 16, 2),
      styles,
      sortedByStart: true,
      monotonicEnd: true,
      nonOverlapping: true,
    })
    const second = EditorTokenStore.fromPacked({
      starts: new Uint32Array(backing, 24, 3),
      ends: new Uint32Array(backing, 28, 3),
      styleIds: new Uint32Array(backing, 32, 3),
      styles,
      sortedByStart: true,
      monotonicEnd: true,
      nonOverlapping: true,
    })

    expect(EditorTokenStore.inspectRetention([first, second, first])).toEqual({
      storeCount: 2,
      tokenCount: 5,
      segmentCount: 2,
      backingBufferCount: 1,
      backingBytes: 4096,
      unmeasuredBytes: ['javascript-objects', 'styles'],
    })
  })

  it('counts original backing retained by partial segments and shared derived stores', () => {
    const starts = Uint32Array.from({ length: 200 }, (_, index) => index * 2)
    const ends = Uint32Array.from(starts, (start) => start + 1)
    const base = EditorTokenStore.fromPacked({
      starts,
      ends,
      styleIds: new Uint32Array(200),
      styles,
      sortedByStart: true,
      monotonicEnd: true,
      nonOverlapping: true,
    })
    const partial = base.replaceRange(70, 130, emptyRun, { delta: 0, keepsLiveRanges: true })

    expect(EditorTokenStore.inspectRetention([partial])).toMatchObject({
      storeCount: 1,
      tokenCount: 140,
      segmentCount: 2,
      backingBufferCount: 3,
      backingBytes: 2400,
    })
    expect(EditorTokenStore.inspectRetention(new Set([base, partial]))).toMatchObject({
      storeCount: 2,
      tokenCount: 340,
      backingBufferCount: 3,
      backingBytes: 2400,
    })
  })

  it('includes the lazy running-end index only when the store retains it', () => {
    const store = EditorTokenStore.fromPacked({
      starts: new Uint32Array([0, 1, 2]),
      ends: new Uint32Array([10, 3, 4]),
      styleIds: new Uint32Array(3),
      styles,
      sortedByStart: true,
      monotonicEnd: false,
      nonOverlapping: false,
    })
    expect(EditorTokenStore.inspectRetention([store]).backingBytes).toBe(36)
    store.firstEndingAfter(5)
    expect(EditorTokenStore.inspectRetention([store, store])).toMatchObject({
      backingBufferCount: 4,
      backingBytes: 48,
    })
  })

  it('reports no backing for empty inputs and empty stores', () => {
    expect(EditorTokenStore.inspectRetention([])).toMatchObject({
      storeCount: 0,
      tokenCount: 0,
      segmentCount: 0,
      backingBufferCount: 0,
      backingBytes: 0,
    })
    expect(EditorTokenStore.inspectRetention([EditorTokenStore.empty()])).toMatchObject({
      storeCount: 1,
      tokenCount: 0,
      backingBufferCount: 0,
      backingBytes: 0,
    })
  })
})
