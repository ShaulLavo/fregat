import { describe, expect, it } from 'vitest'

import { INVISIBLE_CODE_POINT_DATA } from '../src/unicodeHighlightData'
import { BIDI_CONTROL_CODE_POINTS, containsRTL } from '../src/textCharacters'
import {
  bidiVisualRunIndexAt,
  memoizedContainsRTL,
  rtlClassifierScanCount,
} from '../src/virtualization/virtualizedTextViewBidi'
import { rowMightContainRTL } from '../src/virtualization/virtualizedTextViewGeometry'
import type { VirtualizedTextViewInternal } from '../src/virtualization/virtualizedTextViewInternals'
import type { MountedVirtualizedTextRow } from '../src/virtualization/virtualizedTextViewTypes'

describe('BiDi row classifier', () => {
  it('recognizes RTL scripts and every layout-affecting bidi control', () => {
    expect(containsRTL('שלום')).toBe(true)
    expect(containsRTL('مرحبا')).toBe(true)
    expect(containsRTL('日本語')).toBe(false)
    expect(containsRTL('plain Latin')).toBe(false)
    for (const codePoint of BIDI_CONTROL_CODE_POINTS) {
      expect(containsRTL(`abc${String.fromCodePoint(codePoint)}def`)).toBe(true)
    }
  })

  it('uses Unicode 17 assigned classes and right-to-left missing defaults', () => {
    expect(containsRTL(String.fromCodePoint(0x088f))).toBe(true)
    expect(containsRTL(String.fromCodePoint(0x10d50))).toBe(true)
    expect(containsRTL(String.fromCodePoint(0x10d66))).toBe(true)
    expect(containsRTL(String.fromCodePoint(0x10d70))).toBe(true)
    expect(containsRTL(String.fromCodePoint(0x10d40))).toBe(false)
    expect(containsRTL(String.fromCodePoint(0x10d69))).toBe(false)
    expect(containsRTL(String.fromCodePoint(0x10d6e))).toBe(false)
    expect(containsRTL('\ud803')).toBe(false)
    expect(containsRTL('\udd50')).toBe(false)
  })

  it('keeps the eleven bidi controls aligned with the invisible-character table', () => {
    const invisible = new Set<number>(JSON.parse(INVISIBLE_CODE_POINT_DATA) as number[])
    for (const codePoint of BIDI_CONTROL_CODE_POINTS) expect(invisible.has(codePoint)).toBe(true)
  })

  it('scans a row once per text revision', () => {
    const view = { textRevision: 4 } as VirtualizedTextViewInternal
    const line = 'א'.repeat(6_000)

    expect(memoizedContainsRTL(view, line)).toBe(true)
    expect(memoizedContainsRTL(view, line)).toBe(true)
    expect(rtlClassifierScanCount(view)).toBe(1)

    ;(view as { textRevision: number }).textRevision = 5
    expect(memoizedContainsRTL(view, line)).toBe(true)
    expect(rtlClassifierScanCount(view)).toBe(1)
  })

  it('memoizes the absence proof for a 2MB ASCII line', () => {
    const view = { textRevision: 9 } as VirtualizedTextViewInternal
    const line = 'x'.repeat(2_000_000)

    expect(memoizedContainsRTL(view, line)).toBe(false)
    expect(memoizedContainsRTL(view, line)).toBe(false)
    expect(rtlClassifierScanCount(view)).toBe(1)
  })

  it('reuses the memo when caret geometry classifies an ASCII row', () => {
    const view = { textRevision: 11 } as VirtualizedTextViewInternal
    const row = { text: 'x'.repeat(2_000_000) } as MountedVirtualizedTextRow

    expect(rowMightContainRTL(view, row)).toBe(false)
    expect(rowMightContainRTL(view, row)).toBe(false)
    expect(rtlClassifierScanCount(view)).toBe(1)
  })

  it('uses affinity to choose a visual run at a shared boundary', () => {
    const nested = [
      { startOffset: 7, endOffset: 11, direction: 'rtl' },
      { startOffset: 4, endOffset: 7, direction: 'ltr' },
      { startOffset: 0, endOffset: 4, direction: 'rtl' },
    ] as const

    expect(bidiVisualRunIndexAt(nested, 4, 'before')).toBe(2)
    expect(bidiVisualRunIndexAt(nested, 4, 'after')).toBe(1)
    expect(bidiVisualRunIndexAt(nested, 7, 'before')).toBe(1)
    expect(bidiVisualRunIndexAt(nested, 7, 'after')).toBe(0)
    expect(bidiVisualRunIndexAt(nested, 5, 'before')).toBe(1)
    expect(bidiVisualRunIndexAt(nested, 0, 'before')).toBeNull()
    expect(bidiVisualRunIndexAt(nested, 0, 'after')).toBe(2)
    expect(bidiVisualRunIndexAt(nested, 11, 'before')).toBe(0)
    expect(bidiVisualRunIndexAt(nested, 11, 'after')).toBeNull()
    expect(bidiVisualRunIndexAt(nested, 12, 'after')).toBeNull()
  })

  it('caches a logical index for logarithmic lookup in visual runs', () => {
    const values = Array.from({ length: 1_024 }, (_, index) => ({
      startOffset: index,
      endOffset: index + 1,
      direction: index % 2 === 0 ? ('ltr' as const) : ('rtl' as const),
    })).reverse()
    let reads = 0
    const runs = new Proxy(values, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) reads += 1
        return Reflect.get(target, property, receiver)
      },
    })

    expect(bidiVisualRunIndexAt(runs, 512, 'after')).toBe(511)
    reads = 0
    expect(bidiVisualRunIndexAt(runs, 700, 'after')).toBe(323)
    expect(reads).toBeLessThanOrEqual(20)
  })
})
