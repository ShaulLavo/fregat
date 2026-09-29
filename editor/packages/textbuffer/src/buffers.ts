import { TextPageOwner, TextPageRegistry } from './textPages'
import type {
  Piece,
  PieceBufferChunks,
  PieceBufferId,
  PieceBufferLineIndex,
  PieceTableBuffers,
} from './pieceTableTypes'
import { PIECE_ORDER_STEP } from './orders'
import { DEFAULT_DOCUMENT_LINE_ENDING, type DocumentLineEnding } from './lineEndings'
import { recordTextBufferDiagnostic } from './diagnostics'
import { containsSurrogate } from './surrogates'
import {
  copyTextRange,
  sparseSpanAt,
  unionTextRanges,
  type BufferTextSpan,
  type SparseText,
  type TextRange,
} from './textSpans'
export { copyTextRange, type BufferTextSpan } from './textSpans'

export const BUFFER_CHUNK_SIZE = 16 * 1024
const LINE_INDEX_MIN_CAPACITY = 64
const CARRIAGE_RETURN = 0x0d
const HIGH_SURROGATE_FIRST = 0xd800
const HIGH_SURROGATE_LAST = 0xdbff

// Each append branch owns a log. Only a snapshot whose extent matches it exactly
// may append to it in place; every other snapshot reads through its own extent
// and forks the log before it writes. Chunk 0 is the original text and is
// never extended; inserted text fills the newest chunk before opening another.
type PieceBufferLog = {
  // Sparse chunks keep logical extents; their physical spans own only retained text.
  readonly chunks: (string | SparseText)[]
  // Buffer id → chunk sequence. Several buffers share a chunk once inserts fill it.
  readonly chunkOfBuffer: number[]
  readonly lineIndexes: Map<number, PieceBufferLineIndex>
  readonly textOwners: Map<number, TextPageOwner>
  readonly textPages: TextPageRegistry
  // Proper insertion slices can retain source text belonging to another chunk.
  readonly borrowedChunks: Set<number>
  sharedTailOwner: boolean
  // The tail chunk's last code unit. The tail is a fresh concatenation after
  // every keystroke and charCodeAt would flatten it; the insert probe reads
  // this unit on every keystroke, so it is remembered from the appended text.
  tailLastUnit: number
}

export type PieceBufferStoreExtent = {
  readonly chunkCount: number
  readonly bufferCount: number
  readonly tailLength: number
  readonly overflowingChunk: number | null
  readonly retainedChunkCount: number
  readonly retainedCodeUnits: number
}

class PieceBufferChunkView implements PieceBufferChunks {
  public readonly [Symbol.toStringTag] = 'PieceBufferChunkView'

  public constructor(
    private readonly log: PieceBufferLog,
    public readonly size: number,
    public readonly tailLength: number,
    public readonly bufferCount: number,
    // Line breaks in this view's tail, so an appended piece knows where its
    // breaks begin in the tail's index without that index existing yet.
    public readonly tailLineBreaks: number,
  ) {}

  public static from(original: string): PieceBufferChunkView {
    const log = {
      chunks: [original],
      chunkOfBuffer: [0],
      lineIndexes: new Map(),
      textOwners: new Map(),
      textPages: new TextPageRegistry(),
      borrowedChunks: new Set<number>(),
      sharedTailOwner: false,
      tailLastUnit: original.charCodeAt(original.length - 1),
    }
    return new PieceBufferChunkView(log, 1, original.length, 1, 0)
  }

  public get lineIndexes(): Map<number, PieceBufferLineIndex> {
    return this.log.lineIndexes
  }

  public get storageIdentity(): object {
    return this.log
  }

  public get textPages(): TextPageRegistry {
    return this.log.textPages
  }

  public *retainedTextOwners(): Generator<void, Set<TextPageOwner>> {
    const owners = new Set<TextPageOwner>()
    for (const [chunk, owner] of this.log.textOwners) {
      if (chunk < this.size) owners.add(owner)
      yield
    }
    return owners
  }

  public *reclaimGroup(
    sources: readonly PieceBufferChunkView[],
    liveRanges: ReadonlyMap<number, TextRange[]>,
    result: { chunks: number; codeUnits: number },
  ): Generator<void, Map<PieceBufferChunkView, PieceBufferChunkView>> {
    const tails = new Set<number>()
    for (const source of sources) {
      if (source.size > 1) tails.add(source.size - 1)
      yield
    }
    const chunks: PieceBufferLog['chunks'] = []
    const changed = new Set<number>()
    for (let chunk = 0; chunk < this.size; chunk++) {
      const entry = this.log.chunks[chunk]!
      const next = tails.has(chunk)
        ? entry
        : yield* this.reclaimChunk(chunk, liveRanges.get(chunk) ?? [])
      chunks.push(next)
      if (next !== entry) changed.add(chunk)
      if (chunk % 256 === 255) yield
    }
    if (changed.size === 0) return new Map()
    if (this.size > 1) chunks[this.size - 1] = this.chunkText(this.size - 1)
    const copied = new Set<number>()
    yield* this.detachSurvivors(chunks, copied)
    const chunkOfBuffer: number[] = []
    for (let buffer = 0; buffer < this.bufferCount; buffer++) {
      chunkOfBuffer.push(this.log.chunkOfBuffer[buffer]!)
      if (buffer % 256 === 255) yield
    }
    const lineIndexes = new Map<number, PieceBufferLineIndex>()
    let visitedIndexes = 0
    for (const [chunk, index] of this.log.lineIndexes) {
      if (++visitedIndexes % 256 === 0) yield
      const entry = chunks[chunk]
      if (entry === undefined || (typeof entry !== 'string' && entry.retainedLength === 0)) continue
      lineIndexes.set(
        chunk,
        shareOrCopyLineIndex(index, this.chunkLength(chunk), chunk > 0 && chunk === this.size - 1),
      )
    }
    const textOwners = new Map<number, TextPageOwner>()
    for (const [chunk, owner] of this.log.textOwners) {
      if (
        chunk < this.size &&
        !changed.has(chunk) &&
        !copied.has(chunk) &&
        chunks[chunk] === this.log.chunks[chunk]
      )
        textOwners.set(chunk, owner)
      yield
    }
    const sharedTailOwner = this.size > 1 && textOwners.has(this.size - 1)
    if (sharedTailOwner && this.size === this.log.chunks.length) this.log.sharedTailOwner = true
    const log: PieceBufferLog = {
      chunks,
      chunkOfBuffer,
      lineIndexes,
      textOwners,
      textPages: this.log.textPages,
      borrowedChunks: new Set(),
      sharedTailOwner,
      tailLastUnit:
        this.size > 1 ? this.chunkText(this.size - 1).charCodeAt(this.tailLength - 1) : -1,
    }
    const views = new Map<PieceBufferChunkView, PieceBufferChunkView>()
    for (const source of sources) {
      views.set(
        source,
        new PieceBufferChunkView(
          log,
          source.size,
          source.tailLength,
          source.bufferCount,
          source.tailLineBreaks,
        ),
      )
      yield
    }
    for (const chunk of changed) {
      const before = this.log.chunks[chunk]!
      const after = chunks[chunk]!
      result.chunks++
      result.codeUnits += retainedTextLength(before) - retainedTextLength(after)
      yield
    }
    return views
  }

  private *detachSurvivors(chunks: PieceBufferLog['chunks'], copied: Set<number>): Generator<void> {
    let visited = 0
    for (const chunk of this.log.borrowedChunks) {
      if (++visited % 256 === 0) yield
      const text = chunks[chunk]
      if (typeof text !== 'string') continue
      chunks[chunk] = copyTextRange(text, 0, text.length)
      copied.add(chunk)
      yield
    }
  }

  private *reclaimChunk(chunk: number, marked: TextRange[]): Generator<void, string | SparseText> {
    const entry = this.log.chunks[chunk]!
    const ranges = yield* unionTextRanges(marked)
    let retainedLength = 0
    for (let index = 0; index < ranges.length; index++) {
      retainedLength += ranges[index]!.end - ranges[index]!.start
      if (index % 256 === 255) yield
    }
    if (retainedLength === retainedTextLength(entry)) return entry
    // Append chunks are bounded; original text already owns a complete index.
    if (retainedLength > 0 && typeof entry === 'string') this.ensureLineIndex(chunk, entry)
    const spans: BufferTextSpan[] = []
    for (const range of ranges) yield* this.copyRange(chunk, range, spans)
    return { length: entry.length, retainedLength, spans }
  }

  private ensureLineIndex(chunk: number, text: string): void {
    let index = this.log.lineIndexes.get(chunk)
    if (!index) {
      index = { offsets: new Uint32Array(0), count: 0, scannedLength: 0 }
      this.log.lineIndexes.set(chunk, index)
    }
    if (index.scannedLength < text.length) extendBufferLineIndex(index, text)
  }

  private *copyRange(chunk: number, range: TextRange, spans: BufferTextSpan[]): Generator<void> {
    let at = range.start
    while (at < range.end) {
      const source = this.spanAtChunk(chunk, at)
      const end = Math.min(range.end, source.end, at + BUFFER_CHUNK_SIZE)
      if (at === source.start && end === source.end) spans.push(source)
      else {
        const text = copyTextRange(source.text, at - source.start, end - source.start)
        spans.push({ start: at, end, text, owner: new TextPageOwner(this.log.textPages, true) })
      }
      at = end
      yield
    }
  }

  public chunkLength(chunk: number): number {
    return chunk === this.size - 1 ? this.tailLength : this.log.chunks[chunk]!.length
  }

  public spanAt(buffer: PieceBufferId, offset: number): BufferTextSpan {
    const chunk = this.chunkOf(buffer)
    if (chunk === undefined) throw new RangeError('piece buffer not found')
    if (offset < 0 || offset >= this.chunkLength(chunk))
      throw new RangeError('invalid buffer offset')
    return this.spanAtChunk(chunk, offset)
  }

  private spanAtChunk(chunk: number, offset: number): BufferTextSpan {
    const entry = this.log.chunks[chunk]!
    if (typeof entry !== 'string') return sparseSpanAt(entry, offset)
    let owner = this.log.textOwners.get(chunk)
    if (!owner) {
      owner = new TextPageOwner(this.log.textPages)
      this.log.textOwners.set(chunk, owner)
    }
    return { text: this.chunkText(chunk), start: 0, end: this.chunkLength(chunk), owner }
  }

  public chunkOf(buffer: PieceBufferId): number | undefined {
    return buffer < this.bufferCount ? this.log.chunkOfBuffer[buffer] : undefined
  }

  public chunkText(chunk: number): string {
    const text = this.log.chunks[chunk]!
    if (typeof text !== 'string') throw new RangeError('piece buffer text reclaimed')
    if (chunk !== this.size - 1 || text.length === this.tailLength) return text
    // A newer snapshot grew the tail after this one; the extent is the truth.
    return text.slice(0, this.tailLength)
  }

  public get(buffer: PieceBufferId): string | undefined {
    const chunk = this.chunkOf(buffer)
    if (chunk === undefined || typeof this.log.chunks[chunk] !== 'string') return undefined
    return this.chunkText(chunk)
  }

  public retiredLength(buffer: PieceBufferId): number | undefined {
    const chunk = this.chunkOf(buffer)
    if (chunk === undefined) return undefined
    const entry = this.log.chunks[chunk]
    return typeof entry === 'object' && entry.retainedLength === 0 ? entry.length : undefined
  }

  // A code unit of a buffer's chunk without flattening the tail: the unit
  // this view's tail ends on is served from the log's record of it.
  public unitAt(buffer: PieceBufferId, index: number): number {
    const chunk = this.chunkOf(buffer)
    if (chunk === undefined) return -1
    const text = this.log.chunks[chunk]!
    if (typeof text !== 'string') {
      const span = sparseSpanAt(text, index)
      return span.text.charCodeAt(index - span.start)
    }
    // An older view's tail is not the log's once a newer view opened a chunk.
    if (
      chunk > 0 &&
      chunk === this.log.chunks.length - 1 &&
      index === this.tailLength - 1 &&
      text.length === this.tailLength
    ) {
      return this.log.tailLastUnit
    }
    return text.charCodeAt(index)
  }

  public *entries(): IterableIterator<[PieceBufferId, string]> {
    for (let sequence = 0; sequence < this.bufferCount; sequence += 1) {
      const buffer = createBufferId(sequence)
      const text = this.get(buffer)
      if (text !== undefined) yield [buffer, text]
    }
  }

  public *keys(): IterableIterator<PieceBufferId> {
    for (const [key] of this.entries()) yield key
  }

  public [Symbol.iterator](): IterableIterator<[PieceBufferId, string]> {
    return this.entries()
  }

  public extent(): PieceBufferStoreExtent {
    let overflowingChunk: number | null = null
    let retainedChunkCount = 0
    let retainedCodeUnits = 0
    for (let chunk = 0; chunk < this.size; chunk += 1) {
      const entry = this.log.chunks[chunk]!
      const retained = typeof entry === 'string' ? this.chunkLength(chunk) : entry.retainedLength
      if (retained > 0) retainedChunkCount++
      retainedCodeUnits += retained
      if (chunk > 0 && entry.length > BUFFER_CHUNK_SIZE && overflowingChunk === null)
        overflowingChunk = chunk
    }
    return {
      chunkCount: this.size,
      bufferCount: this.bufferCount,
      tailLength: this.tailLength,
      overflowingChunk,
      retainedChunkCount,
      retainedCodeUnits,
    }
  }

  // True only for the view that last wrote the log: a longer log means another
  // branch, or an undone one re-minting the same ids, appended after this view.
  public isCurrent(): boolean {
    const { chunks, chunkOfBuffer } = this.log
    return (
      chunks.length === this.size &&
      chunkOfBuffer.length === this.bufferCount &&
      chunks[this.size - 1]!.length === this.tailLength
    )
  }

  public fork(): PieceBufferChunkView {
    const chunks = this.log.chunks.slice(0, this.size)
    if (this.size > 1) chunks[this.size - 1] = this.chunkText(this.size - 1)
    const lineIndexes = new Map<number, PieceBufferLineIndex>()
    for (const [chunk, index] of this.log.lineIndexes) {
      if (chunk >= this.size) continue
      lineIndexes.set(
        chunk,
        shareOrCopyLineIndex(index, this.chunkLength(chunk), chunk > 0 && chunk === this.size - 1),
      )
    }
    const textOwners = new Map<number, TextPageOwner>()
    for (const [chunk, owner] of this.log.textOwners) {
      if (chunk < this.size && (chunk === 0 || chunk !== this.size - 1))
        textOwners.set(chunk, owner)
    }
    const borrowedChunks = new Set<number>()
    for (const chunk of this.log.borrowedChunks) {
      if (chunk < this.size) borrowedChunks.add(chunk)
    }
    const log = {
      chunks,
      chunkOfBuffer: this.log.chunkOfBuffer.slice(0, this.bufferCount),
      lineIndexes,
      textOwners,
      textPages: this.log.textPages,
      borrowedChunks,
      sharedTailOwner: false,
      tailLastUnit:
        this.size > 1 ? this.chunkText(this.size - 1).charCodeAt(this.tailLength - 1) : -1,
    }
    return new PieceBufferChunkView(
      log,
      this.size,
      this.tailLength,
      this.bufferCount,
      this.tailLineBreaks,
    )
  }

  public extendTail(text: string, lineBreaks: number): PieceBufferChunkView {
    this.ownTail()
    this.log.chunks[this.size - 1] = this.chunkText(this.size - 1) + text
    this.log.tailLastUnit = text.charCodeAt(text.length - 1)
    return new PieceBufferChunkView(
      this.log,
      this.size,
      this.tailLength + text.length,
      this.bufferCount,
      this.tailLineBreaks + lineBreaks,
    )
  }

  public fill(text: string, lineBreaks: number, borrowed: boolean): PieceBufferChunkView {
    this.ownTail()
    if (borrowed) this.log.borrowedChunks.add(this.size - 1)
    this.log.chunks[this.size - 1] = this.chunkText(this.size - 1) + text
    this.log.chunkOfBuffer.push(this.size - 1)
    this.log.tailLastUnit = text.charCodeAt(text.length - 1)
    return new PieceBufferChunkView(
      this.log,
      this.size,
      this.tailLength + text.length,
      this.bufferCount + 1,
      this.tailLineBreaks + lineBreaks,
    )
  }

  public open(text: string, lineBreaks: number, borrowed: boolean): PieceBufferChunkView {
    this.log.sharedTailOwner = false
    if (borrowed) this.log.borrowedChunks.add(this.size)
    this.log.chunks.push(text)
    this.log.chunkOfBuffer.push(this.size)
    this.log.tailLastUnit = text.charCodeAt(text.length - 1)
    return new PieceBufferChunkView(
      this.log,
      this.size + 1,
      text.length,
      this.bufferCount + 1,
      lineBreaks,
    )
  }

  private ownTail(): void {
    if (!this.log.sharedTailOwner) return
    // Maintenance shares the unchanged tail; either log must fork its owner before appending.
    this.log.textOwners.delete(this.size - 1)
    this.log.sharedTailOwner = false
  }
}

const retainedTextLength = (entry: string | SparseText): number =>
  typeof entry === 'string' ? entry.length : entry.retainedLength

// Mutable tails must own their index even when their current extent is fully scanned.
const shareOrCopyLineIndex = (
  index: PieceBufferLineIndex,
  length: number,
  canGrow: boolean,
): PieceBufferLineIndex => {
  if (!canGrow && index.scannedLength <= length) return index
  const count = firstLineBreakAtOrAfter(index, length)
  return {
    offsets: index.offsets.slice(0, count),
    count,
    scannedLength: Math.min(index.scannedLength, length),
  }
}

export type PieceTableBufferOptions = {
  // Recorded, not applied: `original` is expected to already be LF-normalized
  // by the caller (see createPieceTableSnapshot).
  readonly lineEnding?: DocumentLineEnding
  readonly byteOrderMark?: string
  // For callers that ingested the text themselves: the folded text no longer
  // carries the evidence, so their own finding is the only source left.
  readonly containsUnusualLineTerminators?: boolean
  // For a caller that already knows. True is always safe; false is trusted.
  readonly containsSurrogates?: boolean
  // Edits mutate in place between explicit retains instead of cloning every
  // path. The caller then owns the retain points; see retainPieceTableSnapshot.
  readonly transient?: boolean
}

export type AppendChunksToBuffersResult = {
  readonly buffers: PieceTableBuffers
  readonly pieces: readonly Piece[]
}

const createBufferId = (sequence: number): PieceBufferId => sequence as PieceBufferId

const storeOf = (chunks: PieceBufferChunks): PieceBufferChunkView => {
  if (chunks instanceof PieceBufferChunkView) return chunks
  throw new Error('piece buffer store expected')
}

const writableStore = (chunks: PieceBufferChunks): PieceBufferChunkView => {
  const store = storeOf(chunks)
  return store.isCurrent() ? store : store.fork()
}

// Only the appended text is tested: what was there before is already known.
const withStore = (
  buffers: PieceTableBuffers,
  chunks: PieceBufferChunkView,
  nextBufferSequence: number,
  appended: string,
): PieceTableBuffers => ({
  // Every field by name, in createInitialBuffers' order: one object shape,
  // and a keystroke makes one of these, which a spread makes slower.
  original: buffers.original,
  identity: buffers.identity,
  lineage: buffers.lineage,
  lineIndexes: chunks.lineIndexes,
  chunks,
  nextBufferSequence,
  lineEnding: buffers.lineEnding,
  byteOrderMark: buffers.byteOrderMark,
  containsUnusualLineTerminators: buffers.containsUnusualLineTerminators,
  containsSurrogates: buffers.containsSurrogates || containsSurrogate(appended),
})

export const bufferStoreExtent = (buffers: PieceTableBuffers): PieceBufferStoreExtent | null =>
  buffers.chunks instanceof PieceBufferChunkView ? buffers.chunks.extent() : null

export const chunkOfBuffer = (buffers: PieceTableBuffers, buffer: PieceBufferId): number => {
  const chunk = storeOf(buffers.chunks).chunkOf(buffer)
  if (chunk !== undefined) return chunk
  throw new Error('piece buffer not found')
}

export const retiredBufferLength = (
  buffers: PieceTableBuffers,
  buffer: PieceBufferId,
): number | undefined =>
  buffers.chunks instanceof PieceBufferChunkView ? buffers.chunks.retiredLength(buffer) : undefined

export const bufferTextPages = (buffers: PieceTableBuffers): TextPageRegistry =>
  storeOf(buffers.chunks).textPages

export function* retainedBufferTextOwners(
  buffers: PieceTableBuffers,
): Generator<void, Set<TextPageOwner>> {
  return yield* storeOf(buffers.chunks).retainedTextOwners()
}

export const bufferStorageIdentity = (buffers: PieceTableBuffers): object =>
  storeOf(buffers.chunks).storageIdentity

export function* reclaimBufferGroup(
  sources: readonly PieceTableBuffers[],
  liveRanges: ReadonlyMap<number, TextRange[]>,
  result: { chunks: number; codeUnits: number },
): Generator<void, Map<PieceTableBuffers, PieceTableBuffers>> {
  const stores: PieceBufferChunkView[] = []
  let newest = storeOf(sources[0]!.chunks)
  for (const source of sources) {
    const store = storeOf(source.chunks)
    stores.push(store)
    if (
      store.size > newest.size ||
      (store.size === newest.size && store.tailLength > newest.tailLength)
    )
      newest = store
    yield
  }
  const views = yield* newest.reclaimGroup(stores, liveRanges, result)
  const buffers = new Map<PieceTableBuffers, PieceTableBuffers>()
  for (const source of sources) {
    const view = views.get(storeOf(source.chunks))
    if (view) buffers.set(source, withStore(source, view, source.nextBufferSequence, ''))
    yield
  }
  return buffers
}

export const isNewestBuffer = (buffers: PieceTableBuffers, buffer: PieceBufferId): boolean =>
  buffer === buffers.nextBufferSequence - 1

export const countLineBreaks = (text: string, start = 0, end = text.length): number => {
  let count = 0
  let index = text.indexOf('\n', start)

  while (index !== -1 && index < end) {
    count++
    index = text.indexOf('\n', index + 1)
  }

  return count
}

// One index per chunk string, shared by every snapshot on the log. A chunk only
// ever grows at its end, so an index scanned for a shorter version stays a
// valid prefix and a longer one serves shorter extents through clamping.
const bufferLineIndex = (
  buffers: PieceTableBuffers,
  buffer: PieceBufferId,
  text: string,
): PieceBufferLineIndex => {
  const chunk = chunkOfBuffer(buffers, buffer)
  const indexes = buffers.lineIndexes
  let index = indexes.get(chunk)
  if (!index) {
    index = { offsets: new Uint32Array(0), count: 0, scannedLength: 0 }
    indexes.set(chunk, index)
  }
  if (index.scannedLength < text.length) extendBufferLineIndex(index, text)

  return index
}

const extendBufferLineIndex = (index: PieceBufferLineIndex, text: string): void => {
  const scannedCodeUnits = text.length - index.scannedLength
  let at = text.indexOf('\n', index.scannedLength)
  while (at !== -1) {
    pushLineBreakOffset(index, at)
    at = text.indexOf('\n', at + 1)
  }

  index.scannedLength = text.length
  recordTextBufferDiagnostic('sourceIndex', () => ({
    source: 'piece-buffer',
    sourceBytesRead: scannedCodeUnits * 2,
    scannedCodeUnits,
    retainedIndexBytes: index.offsets.byteLength,
  }))
}

// Four bytes per offset: a 5M-line document costs 20MB of index here, and the
// binary search above stays cache-local. Growth doubles so filling the index one
// break at a time stays linear overall. Offsets cannot overflow 32 bits — V8 caps
// strings near 2^29 code units — so the width needs no widening path.
const pushLineBreakOffset = (index: PieceBufferLineIndex, offset: number): void => {
  if (index.count === index.offsets.length) {
    const grown = new Uint32Array(Math.max(index.offsets.length * 2, LINE_INDEX_MIN_CAPACITY))
    grown.set(index.offsets)
    index.offsets = grown
  }

  index.offsets[index.count] = offset
  index.count += 1
}

const firstLineBreakAtOrAfter = (index: PieceBufferLineIndex, target: number): number => {
  const offsets = index.offsets
  let low = 0
  let high = index.count
  while (low < high) {
    const middle = (low + high) >> 1
    if (offsets[middle]! < target) low = middle + 1
    else high = middle
  }

  return low
}

// The index of a piece's chunk, scanned at least to the piece's end. A longer
// scan serves too: the log is append-only, so it only adds entries after.
const pieceLineIndex = (buffers: PieceTableBuffers, piece: Piece): PieceBufferLineIndex => {
  const index = buffers.lineIndexes.get(chunkOfBuffer(buffers, piece.buffer))
  if (index && index.scannedLength >= piece.start + piece.length) return index
  return bufferLineIndex(buffers, piece.buffer, getBufferText(buffers, piece.buffer))
}

// Line breaks in the first `prefixLength` units of a piece that has some.
export const countPieceLineBreaksBefore = (
  buffers: PieceTableBuffers,
  piece: Piece,
  prefixLength: number,
): number => {
  const offsets = pieceLineIndex(buffers, piece).offsets
  const target = piece.start + prefixLength
  let low = piece.firstLineBreak
  let high = low + piece.lineBreaks
  while (low < high) {
    const middle = (low + high) >> 1
    if (offsets[middle]! < target) low = middle + 1
    else high = middle
  }

  return low - piece.firstLineBreak
}

// Chunk offsets of line breaks; a piece's own start at `piece.firstLineBreak`.
export const pieceLineBreakOffsets = (buffers: PieceTableBuffers, piece: Piece): Uint32Array =>
  pieceLineIndex(buffers, piece).offsets

export const bufferUnitAt = (
  buffers: PieceTableBuffers,
  buffer: PieceBufferId,
  index: number,
): number => storeOf(buffers.chunks).unitAt(buffer, index)

export const getBufferText = (buffers: PieceTableBuffers, buffer: PieceBufferId): string => {
  const text = buffers.chunks.get(buffer)
  if (text !== undefined) return text
  throw new Error('piece buffer not found')
}

export const createPiece = (
  buffers: PieceTableBuffers,
  buffer: PieceBufferId,
  start: number,
  length: number,
  order: number,
  visible = true,
): Piece => {
  const cached = buffers.lineIndexes.get(chunkOfBuffer(buffers, buffer))
  const index =
    cached && cached.scannedLength >= start + length
      ? cached
      : bufferLineIndex(buffers, buffer, getBufferText(buffers, buffer))
  const firstLineBreak = firstLineBreakAtOrAfter(index, start)
  return {
    buffer,
    start,
    length,
    order,
    lineBreaks: firstLineBreakAtOrAfter(index, start + length) - firstLineBreak,
    firstLineBreak,
    visible,
  }
}

export const bufferLength = (buffers: PieceTableBuffers, buffer: PieceBufferId): number => {
  const store = storeOf(buffers.chunks)
  const chunk = store.chunkOf(buffer)
  if (chunk === undefined) throw new RangeError('piece buffer not found')
  return store.chunkLength(chunk)
}

export const bufferSpanAt = (
  buffers: PieceTableBuffers,
  buffer: PieceBufferId,
  offset: number,
): BufferTextSpan => storeOf(buffers.chunks).spanAt(buffer, offset)

export function forEachBufferSpan(
  buffers: PieceTableBuffers,
  buffer: PieceBufferId,
  from: number,
  to: number,
  visit: (text: string, from: number, to: number, owner: TextPageOwner) => void,
): void {
  let at = from
  while (at < to) {
    const span = bufferSpanAt(buffers, buffer, at)
    const end = Math.min(to, span.end)
    visit(span.text, at - span.start, end - span.start, span.owner)
    at = end
  }
}

export function readBufferRange(
  buffers: PieceTableBuffers,
  buffer: PieceBufferId,
  from: number,
  to: number,
): string {
  if (from === to) return ''
  const span = bufferSpanAt(buffers, buffer, from)
  if (to <= span.end) return span.text.slice(from - span.start, to - span.start)
  const parts: string[] = []
  forEachBufferSpan(buffers, buffer, from, to, (text, start, end) =>
    parts.push(text.slice(start, end)),
  )
  return parts.join('')
}

// The walker rejoins code points across piece boundaries, but everything that
// reads a chunk directly (getBufferText and every slice taken from it) would
// see a lone surrogate or a stray CR if a split landed inside a pair. Hold the
// trailing unit back so it starts the next chunk instead. Holding one unit back
// from a full chunk always leaves room to advance; holding it back from a
// one-unit fill leaves nothing, and the caller opens a new chunk instead.
const chunkEndFor = (text: string, start: number, capacity: number): number => {
  const end = start + capacity
  if (end >= text.length) return text.length

  const last = text.charCodeAt(end - 1)
  const splitsPair =
    last === CARRIAGE_RETURN || (last >= HIGH_SURROGATE_FIRST && last <= HIGH_SURROGATE_LAST)
  return splitsPair ? end - 1 : end
}

const createAppendedPiece = (
  sequence: number,
  start: number,
  text: string,
  firstLineBreak: number,
): Piece => ({
  buffer: createBufferId(sequence),
  start,
  length: text.length,
  order: 0,
  lineBreaks: countLineBreaks(text),
  firstLineBreak,
  visible: true,
})

// Each buffer id names one contiguous span of one chunk, so `(buffer, start)`
// stays the insertion identity the reverse index and anchors are keyed by.
// A fill that lands in the newest chunk and the chunks opened after it are
// therefore separate buffers even when they come from one insert.
export const appendChunksToBuffers = (
  buffers: PieceTableBuffers,
  text: string,
): AppendChunksToBuffersResult => {
  let store = writableStore(buffers.chunks)
  let nextBufferSequence = buffers.nextBufferSequence
  const pieces: Piece[] = []
  let offset = 0

  // Chunk 0 is the original text and never grows.
  const room = store.size > 1 ? BUFFER_CHUNK_SIZE - store.tailLength : 0
  const fillEnd = room > 0 ? chunkEndFor(text, 0, room) : 0
  if (fillEnd > 0) {
    const fill = text.slice(0, fillEnd)
    const previousLength = store.tailLength
    const piece = createAppendedPiece(
      nextBufferSequence,
      previousLength,
      fill,
      store.tailLineBreaks,
    )
    pieces.push(piece)
    store = store.fill(fill, piece.lineBreaks, fillEnd < text.length)
    growTailLineIndex(store, previousLength, fill)
    nextBufferSequence += 1
    offset = fillEnd
  }

  while (offset < text.length) {
    const chunkText = text.slice(offset, chunkEndFor(text, offset, BUFFER_CHUNK_SIZE))
    const piece = createAppendedPiece(nextBufferSequence, 0, chunkText, 0)
    pieces.push(piece)
    store = store.open(chunkText, piece.lineBreaks, chunkText.length < text.length)
    nextBufferSequence += 1
    offset += chunkText.length
  }

  return { buffers: withStore(buffers, store, nextBufferSequence, text), pieces }
}

export const extendTailChunk = (
  buffers: PieceTableBuffers,
  text: string,
  lineBreaks: number,
): PieceTableBuffers => {
  if (text.length === 0) return buffers
  if (buffers.chunks.size < 2) throw new Error('piece buffer tail not found')

  const store = writableStore(buffers.chunks)
  const previousLength = store.tailLength
  const grown = store.extendTail(text, lineBreaks)
  growTailLineIndex(grown, previousLength, text)
  return withStore(buffers, grown, buffers.nextBufferSequence, text)
}

// The tail's index, when one exists and is up to date, grows from the appended
// text alone. The grown chunk is a fresh concatenation: scanning it would
// flatten it, and that would happen once per keystroke.
const growTailLineIndex = (
  store: PieceBufferChunkView,
  previousLength: number,
  text: string,
): void => {
  const chunk = store.size - 1
  const index = store.lineIndexes.get(chunk)
  if (!index || index.scannedLength !== previousLength) return

  let at = text.indexOf('\n')
  while (at !== -1) {
    pushLineBreakOffset(index, previousLength + at)
    at = text.indexOf('\n', at + 1)
  }

  index.scannedLength = previousLength + text.length
  recordTextBufferDiagnostic('sourceIndex', () => ({
    source: 'piece-buffer',
    sourceBytesRead: text.length * 2,
    scannedCodeUnits: text.length,
    retainedIndexBytes: index.offsets.byteLength,
  }))
}

export const createInitialBuffers = (
  original: string,
  options: PieceTableBufferOptions = {},
): PieceTableBuffers => {
  const originalBuffer = createBufferId(0)
  const chunks = PieceBufferChunkView.from(original)
  return {
    original: originalBuffer,
    identity: {},
    lineage: { epoch: 0, autoRetain: !options.transient },
    lineIndexes: chunks.lineIndexes,
    chunks,
    nextBufferSequence: 1,
    lineEnding: options.lineEnding ?? DEFAULT_DOCUMENT_LINE_ENDING,
    byteOrderMark: options.byteOrderMark ?? '',
    containsUnusualLineTerminators: options.containsUnusualLineTerminators ?? false,
    containsSurrogates: options.containsSurrogates ?? containsSurrogate(original),
  }
}

export const createOriginalPiece = (buffers: PieceTableBuffers): Piece | null => {
  const original = getBufferText(buffers, buffers.original)
  if (original.length === 0) return null

  return {
    buffer: buffers.original,
    start: 0,
    length: original.length,
    order: PIECE_ORDER_STEP,
    lineBreaks: bufferLineIndex(buffers, buffers.original, original).count,
    firstLineBreak: 0,
    visible: true,
  }
}
