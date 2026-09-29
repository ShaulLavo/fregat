import { arrayLspLineStarts } from '../src/workspace'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createLspContentChanges,
  createLspContentChangesInSnapshot,
  lspPositionToOffset,
  lspPositionToOffsetInSnapshot,
  offsetToLspPosition,
  offsetToLspPositionInSnapshot,
  textEditsToLspContentChanges,
  textEditsToLspContentChangesInSnapshot,
  type LspTextDocumentSnapshot,
  type LspTextSnapshot,
} from '../src/index.ts'

describe('LSP position helpers', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    { path: 'full-sync', options: { incremental: false } },
    { path: 'missing-edits', options: { incremental: true } },
    {
      path: 'invalid-edits',
      options: { incremental: true, edits: [{ from: 9, to: 9, text: 'd' }] },
    },
    {
      path: 'length-mismatch',
      options: { incremental: true, edits: [{ from: 3, to: 3, text: 'de' }] },
    },
  ])('reports $path and serializes the authoritative next snapshot', ({ path, options }) => {
    const record = vi.fn()
    vi.stubGlobal('__EDITOR_PERFORMANCE_DIAGNOSTICS__', record)
    const next = materializingSnapshotDocument('abcd')
    const read = vi.spyOn(next.textSnapshot, 'readRange')
    expect(createLspContentChangesInSnapshot(snapshotDocument('abc'), next, options)).toEqual([
      { text: 'abcd' },
    ])
    expect(read.mock.calls.filter(([start, end]) => start === 0 && end === 4)).toHaveLength(1)
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'lsp.contentChanges.path',
        detail: expect.objectContaining({ path }),
      }),
    )
  })

  it('converts offsets and positions in empty text', () => {
    expect(offsetToLspPosition('', 0)).toEqual({ line: 0, character: 0 })
    expect(lspPositionToOffset('', { line: 10, character: 5 })).toBe(0)
  })

  it('converts offsets and positions at line boundaries', () => {
    const text = 'ab\ncde\n'

    expect(offsetToLspPosition(text, 0)).toEqual({ line: 0, character: 0 })
    expect(offsetToLspPosition(text, 2)).toEqual({ line: 0, character: 2 })
    expect(offsetToLspPosition(text, 3)).toEqual({ line: 1, character: 0 })
    expect(offsetToLspPosition(text, 7)).toEqual({ line: 2, character: 0 })
    expect(lspPositionToOffset(text, { line: 0, character: 99 })).toBe(2)
    expect(lspPositionToOffset(text, { line: 1, character: 2 })).toBe(5)
    expect(lspPositionToOffset(text, { line: 99, character: 1 })).toBe(7)
  })

  it('counts UTF-16 code units', () => {
    const text = '😀a'

    expect(text.length).toBe(3)
    expect(offsetToLspPosition(text, 2)).toEqual({ line: 0, character: 2 })
    expect(lspPositionToOffset(text, { line: 0, character: 2 })).toBe(2)
  })

  it('treats CRLF as one line break and clamps positions before the break', () => {
    const text = 'ab\r\nc'

    expect(offsetToLspPosition(text, 2)).toEqual({ line: 0, character: 2 })
    expect(offsetToLspPosition(text, 3)).toEqual({ line: 0, character: 2 })
    expect(offsetToLspPosition(text, 4)).toEqual({ line: 1, character: 0 })
    expect(lspPositionToOffset(text, { line: 0, character: 99 })).toBe(2)
    expect(lspPositionToOffset(text, { line: 1, character: 1 })).toBe(5)
  })

  it('treats bare carriage returns as line breaks', () => {
    const text = 'ab\rc'

    expect(offsetToLspPosition(text, 2)).toEqual({ line: 0, character: 2 })
    expect(offsetToLspPosition(text, 3)).toEqual({ line: 1, character: 0 })
    expect(lspPositionToOffset(text, { line: 0, character: 99 })).toBe(2)
    expect(lspPositionToOffset(text, { line: 1, character: 1 })).toBe(4)
  })

  it('converts offsets and positions from snapshots without materializing text', () => {
    const document = snapshotDocument('ab\ncde\n')

    expect(offsetToLspPositionInSnapshot(document, 0)).toEqual({ line: 0, character: 0 })
    expect(offsetToLspPositionInSnapshot(document, 2)).toEqual({ line: 0, character: 2 })
    expect(offsetToLspPositionInSnapshot(document, 3)).toEqual({ line: 1, character: 0 })
    expect(offsetToLspPositionInSnapshot(document, 7)).toEqual({ line: 2, character: 0 })
    expect(lspPositionToOffsetInSnapshot(document, { line: 0, character: 99 })).toBe(2)
    expect(lspPositionToOffsetInSnapshot(document, { line: 1, character: 2 })).toBe(5)
    expect(lspPositionToOffsetInSnapshot(document, { line: 99, character: 1 })).toBe(7)
  })

  it('treats CRLF as one snapshot line break and clamps offsets inside the break', () => {
    const document = snapshotDocument('ab\r\nc')

    expect(offsetToLspPositionInSnapshot(document, 2)).toEqual({ line: 0, character: 2 })
    expect(offsetToLspPositionInSnapshot(document, 3)).toEqual({ line: 0, character: 2 })
    expect(offsetToLspPositionInSnapshot(document, 4)).toEqual({ line: 1, character: 0 })
    expect(lspPositionToOffsetInSnapshot(document, { line: 0, character: 99 })).toBe(2)
    expect(lspPositionToOffsetInSnapshot(document, { line: 1, character: 1 })).toBe(5)
  })

  it('counts UTF-16 code units in snapshot positions', () => {
    const document = snapshotDocument('😀a')

    expect(offsetToLspPositionInSnapshot(document, 2)).toEqual({ line: 0, character: 2 })
    expect(lspPositionToOffsetInSnapshot(document, { line: 0, character: 2 })).toBe(2)
  })
})

describe('LSP content change helpers', () => {
  it('creates sequential incremental changes from editor text edits', () => {
    const changes = textEditsToLspContentChanges('abcdef', [
      { from: 1, to: 2, text: 'B' },
      { from: 4, to: 6, text: 'EF' },
    ])

    expect(changes).toEqual([
      {
        range: {
          start: { line: 0, character: 4 },
          end: { line: 0, character: 6 },
        },
        text: 'EF',
      },
      {
        range: {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 2 },
        },
        text: 'B',
      },
    ])
  })

  it('creates incremental ranges from the original document for descending edits', () => {
    const changes = textEditsToLspContentChanges('first\nsecond\nthird', [
      { from: 0, to: 5, text: 'FIRST' },
      { from: 13, to: 18, text: 'third\nnext' },
    ])

    expect(changes).toEqual([
      {
        range: {
          start: { line: 2, character: 0 },
          end: { line: 2, character: 5 },
        },
        text: 'third\nnext',
      },
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
        },
        text: 'FIRST',
      },
    ])
  })

  it('falls back to full content when incremental edits do not produce the target text', () => {
    const changes = createLspContentChanges('abc', 'abX', {
      incremental: true,
      edits: [{ from: 2, to: 3, text: 'Y' }],
    })

    expect(changes).toEqual([{ text: 'abX' }])
  })

  it('uses full content when incremental mode is disabled', () => {
    expect(
      createLspContentChanges('abc', 'abcd', {
        edits: [{ from: 3, to: 3, text: 'd' }],
      }),
    ).toEqual([{ text: 'abcd' }])
  })

  it('creates snapshot incremental ranges without materializing full text', () => {
    const changes = textEditsToLspContentChangesInSnapshot(snapshotDocument('first\nsecond'), [
      { from: 6, to: 12, text: 'SECOND' },
    ])

    expect(changes).toEqual([
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 6 },
        },
        text: 'SECOND',
      },
    ])
  })

  it('uses snapshot incremental changes when edit lengths match the next snapshot', () => {
    const changes = createLspContentChangesInSnapshot(
      snapshotDocument('ab\ncd'),
      snapshotDocument('aXb\ncd'),
      {
        incremental: true,
        edits: [{ from: 1, to: 1, text: 'X' }],
      },
    )

    expect(changes).toEqual([
      {
        range: {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 1 },
        },
        text: 'X',
      },
    ])
  })

  it('falls back to full snapshot content for invalid incremental edits', () => {
    const changes = createLspContentChangesInSnapshot(
      snapshotDocument('abc'),
      materializingSnapshotDocument('abcd'),
      {
        incremental: true,
        edits: [{ from: 5, to: 5, text: 'd' }],
      },
    )

    expect(changes).toEqual([{ text: 'abcd' }])
  })
})

function snapshotDocument(text: string): LspTextDocumentSnapshot {
  return {
    textSnapshot: throwingFullTextSnapshot(text),
    lineStarts: arrayLspLineStarts(lineStarts(text)),
  }
}

function materializingSnapshotDocument(text: string): LspTextDocumentSnapshot {
  return {
    textSnapshot: {
      length: text.length,
      readRange: (start, end) => text.slice(start, end),
      forEachTextChunk: (visit) => visit(text, 0, text.length),
    },
    lineStarts: arrayLspLineStarts(lineStarts(text)),
  }
}

function throwingFullTextSnapshot(text: string): LspTextSnapshot {
  return {
    length: text.length,
    // Wider than any line-break probe, so only a whole-document read trips it.
    readRange: (start, end) => {
      if (start === 0 && end === text.length && text.length > 2) {
        throw new Error('unexpected full text materialization')
      }
      return text.slice(start, end)
    },
    forEachTextChunk: (visit) => visit(text, 0, text.length),
  }
}

function lineStarts(text: string): number[] {
  const starts = [0]
  let index = text.indexOf('\n')

  while (index !== -1) {
    starts.push(index + 1)
    index = text.indexOf('\n', index + 1)
  }

  return starts
}
