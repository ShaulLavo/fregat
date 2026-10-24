import { describe, expect, it } from 'vitest'
import { verifyRangeIndexes } from '../input-range-indexes.mjs'

function indexEvent(detail = {}) {
  return {
    name: 'textMeasurements.index',
    operation: { id: 1 },
    timestampMs: 11,
    detail: { length: 256, sourceLength: 12_834_064, start: 0, end: 256, tabSize: 4, ...detail },
  }
}

function result(diagnostics = [indexEvent()]) {
  return {
    manifest: { fixtures: [{ id: 'short-lines', normalizedLength: 12_834_064 }] },
    samples: [
      {
        fixture: 'short-lines',
        scenario: 'paste',
        views: 'single',
        repetition: 0,
        observation: {
          correlations: [{ operation: { id: 1 }, completedAtMs: 12 }],
          diagnostics,
        },
      },
    ],
  }
}

describe('input range-index evidence', () => {
  it('counts only original-source indexing inside the measured paste operation', () => {
    const run = result([
      indexEvent(),
      indexEvent({ sourceLength: 1536 }),
      { ...indexEvent(), operation: { id: 2 } },
      { ...indexEvent(), timestampMs: 13 },
    ])
    expect(verifyRangeIndexes(run)).toEqual([
      {
        fixture: 'short-lines',
        views: 'single',
        repetition: 0,
        sourceLength: 12_834_064,
        indexedUnits: 256,
      },
    ])
  })

  it('rejects missing length instead of accepting a NaN total', () => {
    const event = indexEvent()
    delete event.detail.length
    expect(() => verifyRangeIndexes(result([event]))).toThrow(/index range/)
  })

  it.each(['length', 'sourceLength', 'start', 'end'])(
    'rejects missing, nonfinite, negative or fractional %s',
    (field) => {
      for (const value of [undefined, null, NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => verifyRangeIndexes(result([indexEvent({ [field]: value })]))).toThrow(
          /index range/,
        )
      }
    },
  )

  it.each([
    ['missing detail', undefined],
    ['null detail', null],
    ['array detail', []],
  ])('rejects %s', (_label, detail) => {
    expect(() => verifyRangeIndexes(result([{ ...indexEvent(), detail }]))).toThrow(/index range/)
  })

  it.each([
    ['length disagrees with endpoints', { length: 255 }],
    ['reversed endpoints', { start: 256, end: 0 }],
    ['range exceeds the source', { length: 1, start: 12_834_064, end: 12_834_065 }],
  ])('rejects inconsistent index ranges: %s', (_label, detail) => {
    expect(() => verifyRangeIndexes(result([indexEvent(detail)]))).toThrow(/index range/)
  })

  it('rejects malformed records even when they cannot be attributed to the original source', () => {
    const invalid = { ...indexEvent({ sourceLength: undefined }), operation: { id: 2 } }
    expect(() => verifyRangeIndexes(result([indexEvent(), invalid]))).toThrow(/index range/)
  })

  it('accepts the bound and rejects missing, zero or excessive index work', () => {
    expect(
      verifyRangeIndexes(result([indexEvent({ length: 512, end: 512 })]))[0].indexedUnits,
    ).toBe(512)
    expect(() => verifyRangeIndexes(result([]))).toThrow(/evidence is missing/)
    expect(() => verifyRangeIndexes(result([indexEvent({ length: 0, end: 0 })]))).toThrow(
      /evidence is missing/,
    )
    expect(() => verifyRangeIndexes(result([indexEvent({ length: 513, end: 513 })]))).toThrow(
      /bounded original source/,
    )
  })
})
