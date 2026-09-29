import { TextPageOwner, TextPageRegistry } from '@singapore-editor/textbuffer/internal/textPages'
import { appendDocumentTextMeasurements } from './documentTextSourceCache'
import { bufferSpanAt } from '@singapore-editor/textbuffer/internal/buffers'
import { reclaimSnapshotStorage } from '@singapore-editor/textbuffer/internal/reclamation'
import {
  createPieceTableSnapshot,
  insertIntoPieceTable,
  deleteFromPieceTable,
  type PieceTableSnapshot,
} from '@singapore-editor/textbuffer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bufferColumnToVisualColumn, visualColumnToBufferColumn } from './displayTransforms'
import { createDocumentTextSnapshot, measureTextSnapshotRange } from './documentTextSnapshot'
import { createEditorBufferSession, createEditorTextBuffer } from './documentSession'
import { containsRTL, isSimpleRowText } from './textCharacters'
import {
  measureString,
  TextMeasurements,
  TextSourceIndex,
  type ColumnMode,
  type MeasuredTextRange,
} from './textMeasurements'
import {
  estimatedColumnToBufferColumn,
  estimatedDisplayCellForColumn,
} from './virtualization/virtualizedTextViewGeometry'

const texts = [
  '',
  'abc\tdef\t',
  '\t\t\t',
  '😀e\u0301\t中\u0080x',
  '\ud800x\udc00',
  '𝄞\t\ufe0f\u200d',
  'שלום\tabc',
  'x'.repeat(255) + '𝄞\t' + 'a'.repeat(520),
  'x'.repeat(255) + '\u{1d185}\t\u{e0100}z',
]
const modes: readonly ColumnMode[] = ['utf16', 'estimated']
const biases = ['before', 'after', 'nearest'] as const
const SOURCE_PAGE_LENGTH = 16 * 1024

afterEach(() => vi.unstubAllGlobals())

function originalSource(snapshot: PieceTableSnapshot): TextSourceIndex {
  const span = bufferSpanAt(snapshot.buffers, snapshot.buffers.original, 0)
  const ranges: MeasuredTextRange[] = []
  appendDocumentTextMeasurements(
    ranges,
    span.owner,
    span.text,
    0,
    Math.min(SOURCE_PAGE_LENGTH, span.text.length),
  )
  return ranges[0]!.source
}

describe('indexed text measurements', () => {
  it('keeps a measured sparse source through reclamation of a distant span', () => {
    const original = createPieceTableSnapshot('x'.repeat(200000))
    const first = deleteFromPieceTable(original, 90000, 10)
    Array.from(reclaimSnapshotStorage([first]))
    const measured = originalSource(first)
    measured.range(0, SOURCE_PAGE_LENGTH, 4)
    const second = deleteFromPieceTable(first, 180000, 10)
    Array.from(reclaimSnapshotStorage([second]))
    expect(originalSource(second)).toBe(measured)
  })

  it('borrows bounded measurement ranges across physical page boundaries', () => {
    const text = 'x'.repeat(SOURCE_PAGE_LENGTH - 1) + '\ud834\udd1e\t' + 'y'.repeat(100_000)
    const owner = new TextPageOwner(new TextPageRegistry())
    const ranges: MeasuredTextRange[] = []
    appendDocumentTextMeasurements(
      ranges,
      owner,
      text,
      SOURCE_PAGE_LENGTH - 6,
      SOURCE_PAGE_LENGTH + 14,
    )
    expect(ranges).toHaveLength(2)
    expect(ranges.map((range) => range.source.text.length)).toEqual([6, 14])
    expect(ranges.every((range) => range.source.text.storageLength === text.length)).toBe(true)
    checkMeasurements(
      text.slice(SOURCE_PAGE_LENGTH - 6, SOURCE_PAGE_LENGTH + 14),
      new TextMeasurements(ranges),
    )
    expect(ranges.every((range) => range.source.text.storageLength === text.length)).toBe(true)
    const overlapping: MeasuredTextRange[] = []
    appendDocumentTextMeasurements(
      overlapping,
      owner,
      text,
      SOURCE_PAGE_LENGTH,
      SOURCE_PAGE_LENGTH + 14,
    )
    expect(overlapping[0]!.source).toBe(ranges[1]!.source)
  })

  it('measures only visible fragments when survivors share one physical page', () => {
    const text = 'x'.repeat(SOURCE_PAGE_LENGTH)
    const owner = new TextPageOwner(new TextPageRegistry())
    const ranges: MeasuredTextRange[] = []
    for (let start = 0; start < text.length; start += 1024)
      appendDocumentTextMeasurements(ranges, owner, text, start, start + 64)
    expect(ranges.reduce((total, range) => total + range.source.text.length, 0)).toBe(1024)
    expect(new TextMeasurements(ranges).columnAt(1024, 4, 'estimated')).toBe(1024)
  })

  it('reuses both sides of an insertion while bounding cached range variants', () => {
    const text = 'x'.repeat(SOURCE_PAGE_LENGTH)
    const owner = new TextPageOwner(new TextPageRegistry())
    const first: MeasuredTextRange[] = []
    appendDocumentTextMeasurements(first, owner, text, 0, 100)
    appendDocumentTextMeasurements(first, owner, text, 100, text.length)
    const repeated: MeasuredTextRange[] = []
    appendDocumentTextMeasurements(repeated, owner, text, 0, 100)
    appendDocumentTextMeasurements(repeated, owner, text, 100, text.length)
    expect(repeated[0]!.source).toBe(first[0]!.source)
    expect(repeated[1]!.source).toBe(first[1]!.source)
    const replacement: MeasuredTextRange[] = []
    appendDocumentTextMeasurements(replacement, owner, text, 200, 300)
    appendDocumentTextMeasurements(replacement, owner, text, 0, 100)
    expect(replacement[1]!.source).not.toBe(first[0]!.source)
    expect(new TextMeasurements(first).columnAt(text.length, 4, 'estimated')).toBe(text.length)
  })

  it('releases a wrapper cache generation while preserving previously returned measurements', () => {
    const original = createPieceTableSnapshot('a'.repeat(4096) + '\t😀tail')
    const current = deleteFromPieceTable(original, 0, 4000)
    const wrapper = createDocumentTextSnapshot(current)
    const before = measureTextSnapshotRange(wrapper, 0, current.length)
    const text = wrapper.materializeFullText()
    const job = reclaimSnapshotStorage([current])
    while (!job.next().done) {
      // Publication preserves the wrapper, but retires its old cache generation.
    }
    const after = measureTextSnapshotRange(wrapper, 0, current.length)
    expect(after).not.toBe(before)
    checkMeasurements(text, before)
    checkMeasurements(text, after)
  })

  it('keeps cached Unicode roots correct when borrowed pages move during reclamation', () => {
    const original = createPieceTableSnapshot('x'.repeat(40_000) + '𝄞\tשלוםe\u0301end')
    const wrapper = createDocumentTextSnapshot(original)
    const before = measureTextSnapshotRange(wrapper, 39_998, original.length)
    const sliced = before.slice(1, before.length - 1)
    const text = wrapper.readRange(39_998, original.length)
    checkMeasurements(text, before)
    const current = deleteFromPieceTable(original, 0, 40_000)
    const job = reclaimSnapshotStorage([current])
    while (!job.next().done) {
      // Existing roots read the relocated page rather than capturing its old string.
    }
    checkMeasurements(text, before)
    checkMeasurements(text.slice(1, -1), sliced)
  })

  it('matches scalar columns and inverse biases across tabs, controls, and Unicode', () => {
    for (const text of texts) checkMeasurements(text, measureString(text))
  })

  it('composes pairs across source pieces and preserves isolated surrogate slices', () => {
    const parts = ['x'.repeat(255) + '\ud834', '\udd1e\t\ud83d', '\ude00e\u0301\t\ud803', '\udd50z']
    const measured = new TextMeasurements(
      parts.map((text) => ({ source: new TextSourceIndex(text), start: 0, end: text.length })),
    )
    const text = parts.join('')
    checkMeasurements(text, measured)
    for (const [start, end] of [
      [255, 256],
      [256, 258],
      [254, 262],
      [259, 265],
    ]) {
      checkMeasurements(text.slice(start, end), measured.slice(start!, end!))
    }
  })

  it('shares unchanged source indexes across edits, views, undo, and divergent branches', () => {
    const indexedLengths: number[] = []
    vi.stubGlobal(
      '__EDITOR_PERFORMANCE_DIAGNOSTICS__',
      (event: { name: string; detail?: { length?: number } }) => {
        if (event.name === 'textMeasurements.index') indexedLengths.push(event.detail!.length!)
      },
    )
    const original = 'a'.repeat(1_048_576)
    const buffer = createEditorTextBuffer(original)
    const session = createEditorBufferSession(buffer)
    const first = measureTextSnapshotRange(buffer.getTextSnapshot(), 0, original.length)
    expect(first.columnAt(original.length, 4, 'utf16')).toBe(original.length)
    const source = originalSource(buffer.getSnapshot())
    session.applyEdits([{ from: 0, to: 0, text: '😀\t' }])
    const changed = measureTextSnapshotRange(buffer.getTextSnapshot(), 0, original.length + 3)
    expect(measureTextSnapshotRange(buffer.getTextSnapshot(), 0, original.length + 3)).toBe(changed)
    expect(changed.columnAt(original.length + 3, 4, 'estimated')).toBe(original.length + 4)
    expect(originalSource(buffer.getSnapshot())).toBe(source)
    session.undo()
    session.applyEdits([{ from: 0, to: 0, text: 'ab\t' }])
    const branched = measureTextSnapshotRange(buffer.getTextSnapshot(), 0, original.length + 3)
    expect(branched.isSimple).toBe(true)
    expect(changed.isSimple).toBe(false)
    expect(first.columnAt(original.length, 7, 'estimated')).toBe(original.length)
    expect(branched.columnAt(original.length + 3, 7, 'estimated')).toBe(original.length + 7)
    const restoredWrapper = createDocumentTextSnapshot(buffer.getSnapshot())
    expect(
      measureTextSnapshotRange(restoredWrapper, 0, original.length + 3).columnAt(3, 4, 'utf16'),
    ).toBe(4)
    expect(indexedLengths.filter((length) => length === SOURCE_PAGE_LENGTH)).toHaveLength(
      original.length / SOURCE_PAGE_LENGTH,
    )
  })

  it('keeps original measurements through reclamation while old ranges remain readable', () => {
    const original = createPieceTableSnapshot('original')
    const inserted = insertIntoPieceTable(original, 0, 'x'.repeat(16384))
    const deleted = deleteFromPieceTable(inserted, 0, 16384)
    const current = insertIntoPieceTable(deleted, 0, '!')
    const source = originalSource(current)
    const oldRange = measureTextSnapshotRange(
      createDocumentTextSnapshot(inserted),
      0,
      inserted.length,
    )
    const job = reclaimSnapshotStorage([current])
    while (!job.next().done) {
      /* Finish maintenance before asking for the retained index. */
    }
    expect(originalSource(current)).toBe(source)
    expect(oldRange.columnAt(inserted.length, 4, 'utf16')).toBe(inserted.length)
    const newRange = measureTextSnapshotRange(
      createDocumentTextSnapshot(current),
      0,
      current.length,
    )
    expect(newRange.columnAt(current.length, 4, 'utf16')).toBe(9)
  })

  it('indexes only the requested old-text slices when paste makes one row measurable', () => {
    const builds: Array<{ length: number; sourceLength: number }> = []
    vi.stubGlobal(
      '__EDITOR_PERFORMANCE_DIAGNOSTICS__',
      (event: { name: string; detail: { length: number; sourceLength: number } }) => {
        if (event.name === 'textMeasurements.index') builds.push(event.detail)
      },
    )
    const original = new TextSourceIndex('a'.repeat(2_097_152))
    const pasted = 'paste 😀 e\u0301 '.repeat(128)
    const measured = new TextMeasurements([
      { source: original, start: 1_000, end: 1_020 },
      { source: new TextSourceIndex(pasted), start: 0, end: pasted.length },
      { source: original, start: 1_020, end: 1_040 },
    ])
    const text = 'a'.repeat(20) + pasted + 'a'.repeat(20)
    const expected = estimatedDisplayCellForColumn(text, text.length, 4)
    const reads = countCharacterReads(() => {
      expect(measured.isSimple).toBe(false)
      expect(measured.columnAt(text.length, 4, 'estimated')).toBe(expected)
      expect(measured.offsetAt(expected, 'nearest', 4, 'estimated')).toBe(text.length)
    })
    expect(reads).toBeLessThan(20_000)
    const originalBuilds = builds.filter((build) => build.sourceLength === original.text.length)
    expect(originalBuilds.reduce((length, build) => length + build.length, 0)).toBeLessThanOrEqual(
      512,
    )
    builds.length = 0
    const overlapping = new TextMeasurements([{ source: original, start: 990, end: 1_045 }])
    expect(overlapping.columnAt(55, 4, 'estimated')).toBe(55)
    expect(builds).toEqual([])
  })

  it('reuses overlapping measured ranges inside a larger source', () => {
    const line = 'abc\t😀e\u0301中'.repeat(4_096)
    const source = new TextSourceIndex('header\n' + line + '\ntrailer')
    const measured = new TextMeasurements([{ source, start: 7, end: 7 + line.length }])
    measured.columnAt(line.length, 4, 'estimated')
    const overlapping = new TextMeasurements([{ source, start: 17, end: 7 + line.length - 10 }])
    const expected = estimatedDisplayCellForColumn(line.slice(10, -10), line.length - 20, 4)
    const reads = countCharacterReads(() => {
      expect(overlapping.columnAt(line.length - 20, 4, 'estimated')).toBe(expected)
    })
    expect(reads).toBeLessThan(4_096)
  })

  it('preserves scalar tabs and isolated surrogate boundaries in demand-indexed source ranges', () => {
    const prefix = 'a'.repeat(2_048)
    const source = new TextSourceIndex(prefix + 'x\ud834\udd1e\t😀e\u0301\t中z' + prefix)
    const ranges: readonly [number, number][] = [
      [2_049, 2_050],
      [2_050, 2_054],
      [2_049, 2_059],
      [2_052, 2_058],
    ]
    for (const [start, end] of ranges) {
      checkMeasurements(
        source.text.slice(start, end),
        new TextMeasurements([{ source, start, end }]),
      )
    }
  })

  it('promotes sparse ranges into complete source indexes without rereading completed branches', () => {
    const indexedUnits = new Map<number, number>()
    vi.stubGlobal(
      '__EDITOR_PERFORMANCE_DIAGNOSTICS__',
      (event: { name: string; detail: { length: number; tabSize: number } }) => {
        if (event.name !== 'textMeasurements.index') return
        const { length, tabSize } = event.detail
        indexedUnits.set(tabSize, (indexedUnits.get(tabSize) ?? 0) + length)
      },
    )
    const prefix = 'a'.repeat(255) + '𝄞\t😀e\u0301'
    const text = prefix + 'b'.repeat(1_024 - prefix.length)
    const source = new TextSourceIndex(text)
    const ranges: readonly [number, number][] = [
      [255, 264],
      [0, 512],
      [0, text.length],
    ]
    for (const [start, end] of ranges) {
      checkMeasurements(text.slice(start, end), new TextMeasurements([{ source, start, end }]))
    }
    expect([...indexedUnits.keys()].sort()).toEqual([1, 2, 4, 7])
    expect([...indexedUnits.values()]).toEqual(Array(4).fill(text.length))
  })

  it('bounds far-column character reads independently of line length', () => {
    const small = queryCharacterReads(1_024)
    const large = queryCharacterReads(131_072)
    expect(large).toBeLessThan(200_000)
    expect(large).toBeLessThan(small * 2 + 1_000)
  })

  it('keeps four active tab sizes without indexing a fifth size for classification', () => {
    const builds: number[] = []
    vi.stubGlobal(
      '__EDITOR_PERFORMANCE_DIAGNOSTICS__',
      (event: { name: string; detail?: { tabSize?: number } }) => {
        if (event.name === 'textMeasurements.index') builds.push(event.detail!.tabSize!)
      },
    )
    const text = 'ab\t'.repeat(10_000)
    const source = new TextSourceIndex(text)
    source.range(0, text.length, 2)
    for (let revision = 0; revision < 3; revision += 1) {
      const measured = new TextMeasurements([{ source, start: 0, end: text.length }])
      expect(measured.isSimple).toBe(true)
      for (const tabSize of [2, 3, 5, 7]) measured.columnAt(text.length, tabSize, 'utf16')
    }
    source.range(0, text.length, 9)
    source.range(0, text.length, 3)
    expect(builds).toEqual([2, 3, 5, 7, 9])
  })
})

function queryCharacterReads(repetitions: number): number {
  const text = 'ab\t😀e\u0301中'.repeat(repetitions)
  const measured = measureString(text)
  measured.columnAt(text.length, 4, 'estimated')
  return countCharacterReads(() => {
    for (let sample = 0; sample < 64; sample += 1) {
      const offset = text.length - 1_024 + sample * 13
      const column = measured.columnAt(offset, 4, 'estimated')
      measured.offsetAt(column, 'nearest', 4, 'estimated')
    }
  })
}

function countCharacterReads(run: () => void): number {
  const charCodeAt = String.prototype.charCodeAt
  const codePointAt = String.prototype.codePointAt
  let reads = 0
  String.prototype.charCodeAt = function (index) {
    reads += 1
    return charCodeAt.call(this, index)
  }
  String.prototype.codePointAt = function (index) {
    reads += 1
    return codePointAt.call(this, index)
  }
  try {
    run()
  } finally {
    String.prototype.charCodeAt = charCodeAt
    String.prototype.codePointAt = codePointAt
  }
  return reads
}

function checkMeasurements(text: string, measured: TextMeasurements): void {
  expect(measured.isSimple).toBe(isSimpleRowText(text))
  expect(measured.containsRTL).toBe(containsRTL(text))
  expect(measured.hasTabs).toBe(text.includes('\t'))
  for (const tabSize of [1, 2, 4, 7]) checkTabSize(text, measured, tabSize)
}

function checkTabSize(text: string, measured: TextMeasurements, tabSize: number): void {
  for (const mode of modes) checkMode(text, measured, tabSize, mode)
}

function checkMode(
  text: string,
  measured: TextMeasurements,
  tabSize: number,
  mode: ColumnMode,
): void {
  const forward = mode === 'utf16' ? bufferColumnToVisualColumn : estimatedDisplayCellForColumn
  const inverse = mode === 'utf16' ? visualColumnToBufferColumn : estimatedColumnToBufferColumn
  for (let offset = 0; offset <= text.length; offset += 1) {
    expect(
      measured.columnAt(offset, tabSize, mode),
      `${mode} offset ${offset} tab ${tabSize}`,
    ).toBe(forward(text, offset, tabSize))
  }
  const width = forward(text, text.length, tabSize)
  for (let column = 0; column <= width + 1; column += 0.5) {
    for (const bias of biases)
      expect(
        measured.offsetAt(column, bias, tabSize, mode),
        `${mode} column ${column} ${bias} tab ${tabSize}`,
      ).toBe(inverse(text, column, bias, tabSize))
  }
}
