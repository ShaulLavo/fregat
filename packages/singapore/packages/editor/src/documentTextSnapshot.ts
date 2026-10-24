import { appendDocumentTextMeasurements } from './documentTextSourceCache'
import {
  streamPieceTableTextChunks,
  materializePieceTableFullText,
  offsetToPoint,
  type PieceTableSnapshot,
  readPieceTableTextRange,
} from '@singapore-editor/textbuffer'
import { getSubtreeLineBreaks } from '@singapore-editor/textbuffer/internal/node'
import { forEachTextInRange } from '@singapore-editor/textbuffer/internal/tree'
import { lineRange, lineStartOffset } from '@singapore-editor/textbuffer/internal/positions'

import { RangeText } from './textContent'
import {
  measureString,
  TextMeasurements,
  TextSourceIndex,
  type MeasuredTextRange,
} from './textMeasurements'

import {
  measureEditorPerformance,
  recordEditorPerformanceDiagnostic,
} from './editor/performanceDiagnostics'

// A row's first offset and the offset of the break that ends it, or of the
// document's end for the last row.
export type TextLineRange = {
  readonly start: number
  readonly end: number
}

// What an ordinary consumer reads through: bounded ranges and line queries, never the whole text.
export type TextReadSnapshot = {
  readonly length: number
  readonly lineCount: number
  lineStart(lineIndex: number): number
  // Both ends from one lookup; two lineStart calls walk the tree twice.
  lineRange(lineIndex: number): TextLineRange
  lineAt(offset: number): number
  readRange(start: number, end: number): string
  forEachTextChunk(visit: (text: string, start: number, end: number) => void): void
}

// O(document length) and not memoized; the caller owns the returned string.
export type TextSnapshot = TextReadSnapshot & {
  materializeFullText(): string
}

export type DocumentTextSnapshot = TextSnapshot & {
  readonly snapshot: PieceTableSnapshot
}

const rangeMeasurements = new WeakMap<
  object,
  WeakMap<TextReadSnapshot, Map<string, TextMeasurements>>
>()
const MAX_CACHED_MEASUREMENT_RANGES = 128

export function measureTextSnapshotRange(
  snapshot: TextReadSnapshot,
  start: number,
  end: number,
): TextMeasurements {
  const storage =
    snapshot instanceof PieceTableDocumentTextSnapshot ? snapshot.snapshot.buffers : snapshot
  let snapshots = rangeMeasurements.get(storage)
  if (!snapshots) {
    snapshots = new WeakMap()
    rangeMeasurements.set(storage, snapshots)
  }
  let ranges = snapshots.get(snapshot)
  if (!ranges) {
    ranges = new Map()
    snapshots.set(snapshot, ranges)
  }
  const key = `${start}:${end}`
  const cached = ranges.get(key)
  if (cached) return cached
  const measured = measureSnapshotRange(snapshot, start, end)
  if (ranges.size === MAX_CACHED_MEASUREMENT_RANGES) {
    const oldest = ranges.keys().next().value
    if (oldest !== undefined) ranges.delete(oldest)
  }
  ranges.set(key, measured)
  return measured
}

function measureSnapshotRange(
  snapshot: TextReadSnapshot,
  start: number,
  end: number,
): TextMeasurements {
  if (snapshot instanceof PieceTableDocumentTextSnapshot) {
    return measureDocumentRange(snapshot.snapshot, start, end)
  }
  if (snapshot instanceof StringTextSnapshot) return snapshot.measureRange(start, end)
  return measureString(snapshot.readRange(start, end))
}

function measureDocumentRange(
  snapshot: PieceTableSnapshot,
  start: number,
  end: number,
): TextMeasurements {
  const ranges: MeasuredTextRange[] = []
  forEachTextInRange(snapshot.root, snapshot.buffers, start, end, (text, from, to, owner) => {
    appendDocumentTextMeasurements(ranges, owner, text, from, to)
  })
  return new TextMeasurements(ranges)
}

export function createDocumentTextSnapshot(
  snapshot: PieceTableSnapshot,
  materializedText?: string,
): DocumentTextSnapshot {
  return new PieceTableDocumentTextSnapshot(snapshot, materializedText)
}

export function createStringTextSnapshot(text: string): TextSnapshot {
  return new StringTextSnapshot(text)
}

class PieceTableDocumentTextSnapshot implements DocumentTextSnapshot {
  readonly length: number
  readonly #retainedText: string | undefined

  constructor(
    readonly snapshot: PieceTableSnapshot,
    materializedText?: string,
  ) {
    this.length = snapshot.length
    this.#retainedText = materializedText?.length === snapshot.length ? materializedText : undefined
  }

  get lineCount(): number {
    return getSubtreeLineBreaks(this.snapshot.root) + 1
  }

  lineStart(lineIndex: number): number {
    return lineStartOffset(this.snapshot, lineIndex)
  }

  lineRange(lineIndex: number): TextLineRange {
    return lineRange(this.snapshot, lineIndex)
  }

  lineAt(offset: number): number {
    return offsetToPoint(this.snapshot, Math.max(0, Math.min(offset, this.length))).row
  }

  materializeFullText(): string {
    const retainedText = this.#retainedText
    recordSnapshotRead(this.length, true, retainedText === undefined ? 1 : 0)
    if (retainedText !== undefined) {
      recordFullTextSnapshotRead('textSnapshot.materializeFullText', this.length, true)
      return retainedText
    }

    return measureEditorPerformance(
      'textSnapshot.materializeFullText',
      () => materializePieceTableFullText(this.snapshot),
      () => fullTextSnapshotDetail(this.length, false),
    )
  }

  readRange(start: number, end: number): string {
    const retainedText = this.#retainedText
    const readsFullText = start === 0 && end === this.length
    recordSnapshotRead(
      Math.max(0, end - start),
      readsFullText,
      retainedText !== undefined && readsFullText ? 0 : 1,
    )
    if (retainedText !== undefined && readsFullText) {
      recordFullTextSnapshotRead('textSnapshot.readRange', this.length, true)
      return retainedText
    }

    if (!readsFullText) return readPieceTableTextRange(this.snapshot, start, end)
    return measureEditorPerformance(
      'textSnapshot.readRange',
      () => readPieceTableTextRange(this.snapshot, start, end),
      () => fullTextSnapshotDetail(this.length, false),
    )
  }

  forEachTextChunk(visit: (text: string, start: number, end: number) => void): void {
    const retainedText = this.#retainedText
    if (retainedText === undefined) {
      let chunks = 0
      streamPieceTableTextChunks(this.snapshot, (text, start, end) => {
        chunks += 1
        visit(text, start, end)
      })
      recordSnapshotRead(this.length, true, chunks)
      return
    }

    recordSnapshotRead(this.length, true, 0)
    if (retainedText.length > 0) visit(retainedText, 0, retainedText.length)
  }
}

class StringTextSnapshot implements TextSnapshot {
  readonly #text: string
  readonly #source: TextSourceIndex
  #lineBreaks: Uint32Array | undefined

  constructor(text: string) {
    this.#text = text
    this.#source = new TextSourceIndex(text)
  }

  get length(): number {
    return this.#text.length
  }

  get lineCount(): number {
    return this.lineBreaks.length + 1
  }

  lineStart(lineIndex: number): number {
    if (lineIndex <= 0) return 0
    const offset = this.lineBreaks[lineIndex - 1]
    return offset === undefined ? this.length : offset + 1
  }

  lineRange(lineIndex: number): TextLineRange {
    const row = Math.max(0, lineIndex)
    return { start: this.lineStart(row), end: this.lineBreaks[row] ?? this.length }
  }

  lineAt(offset: number): number {
    const target = Math.max(0, Math.min(offset, this.length))
    const breaks = this.lineBreaks
    let low = 0
    let high = breaks.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (breaks[middle]! < target) low = middle + 1
      else high = middle
    }
    return low
  }

  measureRange(start: number, end: number): TextMeasurements {
    return new TextMeasurements([{ source: this.#source, start, end }])
  }

  private get lineBreaks(): Uint32Array {
    this.#lineBreaks ??= indexStringLineBreaks(this.#text)
    return this.#lineBreaks
  }

  materializeFullText(): string {
    recordSnapshotRead(this.length, true, 0)
    return this.#text
  }

  readRange(start: number, end: number): string {
    const text = this.#text.slice(start, end)
    recordSnapshotRead(text.length, start === 0 && end === this.length, 1)
    return text
  }

  forEachTextChunk(visit: (text: string, start: number, end: number) => void): void {
    recordSnapshotRead(this.length, true, 0)
    if (this.#text.length > 0) visit(this.#text, 0, this.#text.length)
  }
}

function indexStringLineBreaks(text: string): Uint32Array {
  let offsets = new Uint32Array(64)
  let count = 0
  let offset = text.indexOf('\n')
  while (offset !== -1) {
    if (count === offsets.length) {
      const grown = new Uint32Array(offsets.length * 2)
      grown.set(offsets)
      offsets = grown
    }
    offsets[count++] = offset
    offset = text.indexOf('\n', offset + 1)
  }
  const result = offsets.subarray(0, count)
  recordEditorPerformanceDiagnostic('textSnapshot.sourceIndex', () => ({
    source: 'string',
    sourceBytesRead: text.length * 2,
    scannedCodeUnits: text.length,
    retainedIndexBytes: offsets.byteLength,
  }))
  return result
}

function recordSnapshotRead(length: number, fullText: boolean, materializedStrings: number): void {
  recordEditorPerformanceDiagnostic('textSnapshot.read', () => ({
    sourceBytesRead: length * 2,
    fullTextReads: fullText ? 1 : 0,
    materializedStrings: length > 0 ? materializedStrings : 0,
  }))
}

function recordFullTextSnapshotRead(name: string, length: number, retained: boolean): void {
  recordEditorPerformanceDiagnostic(name, fullTextSnapshotDetail(length, retained))
}

function fullTextSnapshotDetail(
  length: number,
  retained: boolean,
): Readonly<Record<string, unknown>> {
  return {
    length,
    cached: retained,
    retained,
  }
}

/** A range as random-access text: characters come from the source on demand, not one copy. */
export function textSnapshotRangeContent(
  source: TextReadSnapshot,
  start: number,
  end: number,
): RangeText {
  return new RangeText(
    end - start,
    (from, to) => source.readRange(start + from, start + to),
    measureTextSnapshotRange(source, start, end),
  )
}

export function getPieceTreeSnapshot(text: TextReadSnapshot): PieceTableSnapshot | null {
  return text instanceof PieceTableDocumentTextSnapshot ? text.snapshot : null
}
