import { expect, it } from 'vitest'
import '../src/style.css'

import { createInlineMap } from '../src/inlineMap'
import { createPieceTableSnapshot } from '../src/public/document'
import { VirtualizedTextView } from '../src/virtualization'
import {
  getRtlTextClassificationScanCount,
  getRowGeometrySweepCount,
  resetRtlTextClassificationScanCount,
  resetRowGeometrySweepCount,
} from '../src/virtualization/virtualizedTextViewGeometry'

type Mounted = {
  readonly container: HTMLElement
  readonly view: VirtualizedTextView
  readonly mountMs: number
  dispose(): void
}

it('keeps 6,000-character BiDi operations bounded against an equal-length Latin control', () => {
  resetRowGeometrySweepCount()
  const result = measureLength(6_000)
  const measurements = JSON.stringify(result)
  expect(result.mountRatio, measurements).toBeLessThan(5)
  // A Latin click or drag on this row is column arithmetic, microseconds each, so a time ratio
  // against it measures that arithmetic: it doubled when Latin got faster with RTL unchanged. What
  // an RTL operation may cost is its layout reads, and those do not vary with the machine.
  // A click is one native hit test, with the odd boundary disambiguation; a drag step is that plus
  // the selection segment and the caret. None of it may grow with the 6,000-character line.
  const reads = rtlOperationReads('א'.repeat(6_000))
  const readings = `${measurements} ${JSON.stringify(reads)}`
  expect(reads.clickHits, readings).toBeLessThanOrEqual(CLICKS * 1.1)
  expect(reads.clickRanges, readings).toBeLessThanOrEqual(CLICKS * 0.1)
  expect(reads.dragHits, readings).toBeLessThanOrEqual(DRAG_STEPS * 1.1)
  expect(reads.dragRanges, readings).toBeLessThanOrEqual(DRAG_STEPS * 2.1)
  expect(getRowGeometrySweepCount()).toBe(0)
})

const CLICKS = 100
const DRAG_STEPS = 200

/** Native reads over the same clicks and drag steps the timing samples make. */
function rtlOperationReads(text: string) {
  const mounted = mountMeasured(text)
  const row = mounted.view.getState().mountedRows[0]!
  const rect = row.element.getBoundingClientRect()
  const y = rect.top + rect.height / 2
  const xAt = (index: number) => rect.left + 1 + ((index * 2.75) % Math.max(2, rect.width - 2))
  let clickRanges = 0
  const clickHits = countCaretHitReads(() => {
    clickRanges = countRangeReads(() => {
      for (let index = 0; index < CLICKS; index += 1)
        mounted.view.textOffsetFromPoint(xAt(index), y)
    })
  })
  const anchor = mounted.view.textOffsetFromPoint(rect.right - 1, y) ?? 0
  let dragRanges = 0
  const dragHits = countCaretHitReads(() => {
    dragRanges = countRangeReads(() => {
      for (let index = 0; index < DRAG_STEPS; index += 1) {
        const head = mounted.view.textOffsetFromPoint(xAt(index), y)
        if (head !== null) mounted.view.setSelection(anchor, head)
      }
    })
  })
  mounted.dispose()
  return { clickHits, clickRanges, dragHits, dragRanges }
}

it('bounds cold visual-arrow probes on 6,000-character RTL rows', () => {
  const middle = 3_000
  // Fresh rows keep the cache cold; a median resists a single runner scheduling pause.
  const homogeneousMoves = Array.from({ length: 7 }, () =>
    coldVisualMoveForText('א'.repeat(6_000), middle),
  )
  const mixedMove = coldVisualMoveForText('aא'.repeat(3_000), 0)

  for (const move of homogeneousMoves) {
    expect(move.target).toEqual({ offset: middle - 1, affinity: 'after' })
    expect(move.rangeReads).toBe(0)
    expect(move.hitReads).toBe(0)
  }
  expect(
    median(homogeneousMoves.map((move) => move.elapsed)),
    JSON.stringify(homogeneousMoves),
  ).toBeLessThan(12)
  expect(mixedMove.target).toEqual({ offset: 1, affinity: 'before' })
  expect(mixedMove.rangeReads).toBeLessThanOrEqual(8)
  // A cold browser may still have to shape the line before its first Range/native hit. That wall
  // time is runner-dependent; the bounded synchronous reads are the stable proof that length does
  // not turn this arrow into a whole-row geometry sweep.
  expect(mixedMove.hitReads).toBeLessThanOrEqual(12)
})

it('bounds cold visual-arrow reads on a 6,000-character inline-mapped mixed row', () => {
  const text = 'aא'.repeat(3_000)
  const mounted = mountMeasured(text)
  try {
    mounted.view.setInlineMap(
      createInlineMap(createPieceTableSnapshot(text), [
        {
          id: 'end-hint',
          startIndex: text.length,
          endIndex: text.length,
          text: 'HINT',
          insertion: true,
        },
      ]),
    )
    resetRowGeometrySweepCount()

    const move = coldVisualMove(mounted, 0)

    expect(move.target).toEqual({ offset: 1, affinity: 'before' })
    expect(move.rangeReads).toBeLessThanOrEqual(32)
    expect(move.hitReads).toBeLessThanOrEqual(24)
    expect(getRowGeometrySweepCount()).toBe(0)
  } finally {
    mounted.dispose()
  }
})

it('bounds cold vertical motion into a 6,000-character non-simple LTR row', () => {
  const source = 'xxxx'
  const targetText = '日'.repeat(6_000)
  const mounted = mountMeasured(`${source}\n${targetText}`, 40)
  try {
    const targetRow = mounted.view.getState().mountedRows[1]!
    expect(targetRow.geometryCache).toBeNull()
    resetRowGeometrySweepCount()

    let target: ReturnType<VirtualizedTextView['verticalCaretTarget']> | undefined
    const rangeReads = countRangeReads(() => {
      target = mounted.view.verticalCaretTarget(2, 'after', 1, {
        kind: 'horizontal',
        x: mounted.view.getState().metrics.characterWidth * 4,
      })
    })

    expect(target).toBeDefined()
    expect(target!.offset).toBeGreaterThanOrEqual(targetRow.startOffset)
    expect(target!.offset).toBeLessThanOrEqual(targetRow.endOffset)
    expect(rangeReads).toBeLessThanOrEqual(24)
    expect(getRowGeometrySweepCount()).toBe(0)
  } finally {
    mounted.dispose()
  }
})

it('keeps long invisible BiDi-control rows off the homogeneous fast path', () => {
  for (const control of ['\u200F', '\u061C']) {
    const move = coldVisualMoveForText(control.repeat(6_000), 3_000)
    expect(move.target).toBeNull()
    expect(move.rangeReads).toBeLessThanOrEqual(26)
    expect(move.hitReads).toBeLessThanOrEqual(24)
  }
})

it('keeps exact visual motion on ordinary 500-character mixed rows bounded', () => {
  const text = 'aא'.repeat(250)
  coldVisualMoveForText(text, 0)
  const moves: ColdVisualMove[] = []
  for (let sample = 0; sample < 7; sample += 1) {
    moves.push(coldVisualMoveForText(text, 0))
  }

  expect(moves.every((move) => move.target?.offset === 1)).toBe(true)
  expect(moves.every((move) => move.target?.affinity === 'before')).toBe(true)
  expect(moves.every((move) => move.rangeReads <= 8)).toBe(true)
  expect(moves.every((move) => move.hitReads <= 16)).toBe(true)
  expect(median(moves.map((move) => move.elapsed))).toBeLessThan(12)
})

it('crosses into a 6,000-character mixed row without discovering every run', () => {
  const mounted = mountMeasured(`x\n${'aא'.repeat(3_000)}`, 40)
  try {
    const move = coldVisualMove(mounted, 1, 'before')
    expect(move.target).toEqual({ offset: 2, affinity: 'after' })
    expect(move.rangeReads).toBeLessThanOrEqual(8)
    expect(move.hitReads).toBeLessThanOrEqual(4)
  } finally {
    mounted.dispose()
  }
})

it('reuses homogeneous RTL classification across warm visual arrows', () => {
  const mounted = mountMeasured('א'.repeat(6_000))
  try {
    coldVisualMove(mounted, 3_000)
    resetRtlTextClassificationScanCount()
    const moves: ColdVisualMove[] = []
    for (let sample = 0; sample < 7; sample += 1) {
      moves.push(visualMoves(mounted, 3_000, 'after', 500))
    }

    expect(moves.every((move) => move.target?.offset === 2_999)).toBe(true)
    expect(moves.every((move) => move.target?.affinity === 'after')).toBe(true)
    expect(moves.every((move) => move.rangeReads === 0)).toBe(true)
    expect(moves.every((move) => move.hitReads === 0)).toBe(true)
    expect(getRtlTextClassificationScanCount()).toBe(0)
  } finally {
    mounted.dispose()
  }
})

type OperationRatios = {
  readonly length: number
  readonly mountLatinMs: number
  readonly mountRtlMs: number
  readonly mountRatio: number
  readonly clickLatinMs: number
  readonly clickRtlMs: number
  readonly clickRatio: number
  readonly dragLatinMs: number
  readonly dragRtlMs: number
  readonly dragRatio: number
}

type ColdVisualMove = {
  readonly target: ReturnType<VirtualizedTextView['visualHorizontalTarget']>
  readonly rangeReads: number
  readonly hitReads: number
  readonly elapsed: number
}

function measureLength(length: number): OperationRatios {
  const latinText = 'x'.repeat(length)
  const rtlText = 'א'.repeat(length)
  mountMeasured(latinText).dispose()
  mountMeasured(rtlText).dispose()

  // Average repeated full mount operations within each sample. A single mount is sub-millisecond
  // on fast runners, where scheduler jitter can otherwise dominate the same-run control ratio.
  const mounts = measurePairedSamples(
    () => timeMounts(latinText, 5),
    () => timeMounts(rtlText, 5),
  )

  const latin = mountMeasured(latinText)
  const rtl = mountMeasured(rtlText)
  // Batch each operation, alternate control/candidate order, and compare medians. Browser projects
  // share the CI runner, so a single fixed-order batch can otherwise measure scheduler load.
  const clicks = measurePairedSamples(
    () => timeClicks(latin, 100),
    () => timeClicks(rtl, 100),
  )
  const drags = measurePairedSamples(
    () => timeDrag(latin, 200),
    () => timeDrag(rtl, 200),
  )
  const result = {
    length,
    mountLatinMs: round(mounts.latin),
    mountRtlMs: round(mounts.rtl),
    mountRatio: round(mounts.rtl / mounts.latin),
    clickLatinMs: round(clicks.latin),
    clickRtlMs: round(clicks.rtl),
    clickRatio: round(clicks.rtl / clicks.latin),
    dragLatinMs: round(drags.latin),
    dragRtlMs: round(drags.rtl),
    dragRatio: round(drags.rtl / drags.latin),
  }
  latin.dispose()
  rtl.dispose()
  return result
}

function measurePairedSamples(
  measureLatin: () => number,
  measureRtl: () => number,
): { readonly latin: number; readonly rtl: number } {
  const latin: number[] = []
  const rtl: number[] = []
  for (let sample = 0; sample < 7; sample += 1) {
    if (sample % 2 === 0) {
      latin.push(measureLatin())
      rtl.push(measureRtl())
      continue
    }

    rtl.push(measureRtl())
    latin.push(measureLatin())
  }
  return { latin: median(latin), rtl: median(rtl) }
}

function timeMounts(text: string, count: number): number {
  let elapsed = 0
  for (let index = 0; index < count; index += 1) {
    const mounted = mountMeasured(text)
    elapsed += mounted.mountMs
    mounted.dispose()
  }
  return elapsed / count
}

function mountMeasured(text: string, viewportHeight = 20): Mounted {
  const container = document.createElement('div')
  container.style.font = '14px monospace'
  container.style.height = `${viewportHeight}px`
  container.style.width = '600px'
  document.body.append(container)
  const start = performance.now()
  const view = new VirtualizedTextView(container, {
    rowHeight: 20,
    overscan: 0,
    longLineChunkThreshold: text.length + 1,
  })
  view.setText(text)
  view.setScrollMetrics(0, viewportHeight, 600)
  const mountMs = performance.now() - start
  return {
    container,
    view,
    mountMs,
    dispose: () => {
      view.dispose()
      container.remove()
    },
  }
}

function timeClicks(mounted: Mounted, count: number): number {
  const row = mounted.view.getState().mountedRows[0]!
  const rect = row.element.getBoundingClientRect()
  const start = performance.now()
  for (let index = 0; index < count; index += 1) {
    const x = rect.left + 1 + ((index * 2.75) % Math.max(2, rect.width - 2))
    mounted.view.textOffsetFromPoint(x, rect.top + rect.height / 2)
  }
  return performance.now() - start
}

function timeDrag(mounted: Mounted, count: number): number {
  const row = mounted.view.getState().mountedRows[0]!
  const rect = row.element.getBoundingClientRect()
  const y = rect.top + rect.height / 2
  const anchor = mounted.view.textOffsetFromPoint(rect.left + rect.width - 1, y) ?? 0
  const start = performance.now()
  for (let index = 0; index < count; index += 1) {
    const x = rect.left + 1 + ((index * 2.75) % Math.max(2, rect.width - 2))
    const head = mounted.view.textOffsetFromPoint(x, y)
    if (head === null) continue
    mounted.view.setSelection(anchor, head)
  }
  return performance.now() - start
}

function coldVisualMove(
  mounted: Mounted,
  offset: number,
  affinity: 'before' | 'after' = 'after',
): ColdVisualMove {
  return visualMoves(mounted, offset, affinity, 1)
}

function visualMoves(
  mounted: Mounted,
  offset: number,
  affinity: 'before' | 'after',
  count: number,
): ColdVisualMove {
  let target: ColdVisualMove['target'] = null
  let rangeReads = 0
  settleMountedRowLayout(mounted)
  const start = performance.now()
  const hitReads = countCaretHitReads(() => {
    rangeReads = countRangeReads(() => {
      for (let index = 0; index < count; index += 1) {
        target = mounted.view.visualHorizontalTarget(offset, affinity, 'right')
      }
    })
  })
  return { target, rangeReads, hitReads, elapsed: performance.now() - start }
}

function coldVisualMoveForText(
  text: string,
  offset: number,
  affinity: 'before' | 'after' = 'after',
): ColdVisualMove {
  const mounted = mountMeasured(text)
  try {
    return coldVisualMove(mounted, offset, affinity)
  } finally {
    mounted.dispose()
  }
}

function settleMountedRowLayout(mounted: Mounted): void {
  for (const row of mounted.view.getState().mountedRows) row.element.getBoundingClientRect()
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]!
}

function countRangeReads(run: () => void): number {
  const clientRects = Range.prototype.getClientRects
  const boundingRect = Range.prototype.getBoundingClientRect
  let reads = 0
  Range.prototype.getClientRects = function countedClientRects(this: Range) {
    reads += 1
    return clientRects.call(this)
  }
  Range.prototype.getBoundingClientRect = function countedBoundingRect(this: Range) {
    reads += 1
    return boundingRect.call(this)
  }
  try {
    run()
  } finally {
    Range.prototype.getClientRects = clientRects
    Range.prototype.getBoundingClientRect = boundingRect
  }
  return reads
}

function countCaretHitReads(run: () => void): number {
  const positionDescriptor = Object.getOwnPropertyDescriptor(document, 'caretPositionFromPoint')
  const rangeDescriptor = Object.getOwnPropertyDescriptor(document, 'caretRangeFromPoint')
  const caretPositionFromPoint = document.caretPositionFromPoint?.bind(document)
  const caretRangeFromPoint = document.caretRangeFromPoint?.bind(document)
  let reads = 0
  if (caretPositionFromPoint) {
    Object.defineProperty(document, 'caretPositionFromPoint', {
      configurable: true,
      value: (x: number, y: number) => {
        reads += 1
        return caretPositionFromPoint(x, y)
      },
    })
  }
  if (caretRangeFromPoint) {
    Object.defineProperty(document, 'caretRangeFromPoint', {
      configurable: true,
      value: (x: number, y: number) => {
        reads += 1
        return caretRangeFromPoint(x, y)
      },
    })
  }
  try {
    run()
  } finally {
    restoreDocumentProperty('caretPositionFromPoint', positionDescriptor)
    restoreDocumentProperty('caretRangeFromPoint', rangeDescriptor)
  }
  return reads
}

function restoreDocumentProperty(
  name: 'caretPositionFromPoint' | 'caretRangeFromPoint',
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(document, name, descriptor)
    return
  }
  delete (document as unknown as Record<string, unknown>)[name]
}
