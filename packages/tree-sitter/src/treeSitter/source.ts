import type { PieceTableSnapshot } from '@singapore-editor/core/document'
import { debugPieceTable, type PieceBufferId } from '@singapore-editor/core/debug'
import { forEachBufferSpan } from '@singapore-editor/core/debug'

type TreeSitterSourcePieceSpan = {
  readonly chunkId: string
  readonly start: number
  readonly length: number
}

type TreeSitterSourceChunkPayload = {
  readonly chunkId: string
  readonly text: string
}

export type TreeSitterSourceDescriptor = {
  readonly length: number
  readonly pieces: readonly TreeSitterSourcePieceSpan[]
  readonly chunks: readonly TreeSitterSourceChunkPayload[]
}

export type TreeSitterSourceDescriptorOptions = {
  readonly sentChunkLengths?: ReadonlyMap<string, number>
}

type ResolvedTreeSitterSourceChunk = {
  readonly text: string
  readonly length: number
}

export type TreeSitterSourceCache = Map<string, Map<string, ResolvedTreeSitterSourceChunk>>

type TreeSitterInputChunk = {
  readonly start: number
  readonly end: number
  readonly chunkStart: number
  readonly source: ResolvedTreeSitterSourceChunk
}

export type TreeSitterPieceTableInput = {
  readonly length: number
  readonly chunks: readonly TreeSitterInputChunk[]
  lastChunkIndex?: number
}

const SOURCE_CHUNK_SIZE = 16 * 1024
// web-tree-sitter copies parser callback text into a fixed 10KB UTF-16 buffer.
const PARSER_READ_BATCH_CODE_UNITS = 4096
const sourceOwners = new WeakMap<object, number>()
let nextSourceOwner = 1

export const createTreeSitterSourceDescriptor = (
  snapshot: PieceTableSnapshot,
  options: TreeSitterSourceDescriptorOptions = {},
): TreeSitterSourceDescriptor => {
  const pieces: TreeSitterSourcePieceSpan[] = []
  const chunks: TreeSitterSourceChunkPayload[] = []
  const emittedChunkIds = new Set<string>()

  for (const piece of debugPieceTable(snapshot)) {
    if (!piece.visible) continue
    appendPieceSpans(snapshot, piece.buffer, piece.start, piece.length, {
      pieces,
      chunks,
      emittedChunkIds,
      sentChunkLengths: options.sentChunkLengths,
    })
  }

  return {
    length: snapshot.length,
    pieces,
    chunks,
  }
}

export const resolveTreeSitterSourceDescriptor = (
  cache: TreeSitterSourceCache,
  documentId: string,
  descriptor: TreeSitterSourceDescriptor,
): TreeSitterPieceTableInput => {
  const documentCache = ensureDocumentSourceCache(cache, documentId)
  const chunks = resolveDescriptorChunks(documentCache, descriptor)
  // The client forgets the same chunks when it builds the descriptor, so both sides stay in step.
  keepReferencedChunks(documentCache, descriptor)
  return {
    length: descriptor.length,
    chunks,
  }
}

export const disposeTreeSitterSourceDocument = (
  cache: TreeSitterSourceCache,
  documentId: string,
): void => {
  cache.delete(documentId)
}

export const clearTreeSitterSourceCache = (cache: TreeSitterSourceCache): void => {
  cache.clear()
}

export const readTreeSitterPieceTableInput = (
  input: TreeSitterPieceTableInput,
  index: number,
): string | undefined => {
  if (index < 0 || index >= input.length) return undefined

  const chunk = findChunkContainingWithCursor(input, index)
  if (!chunk) return undefined

  const sourceStart = chunk.chunkStart + index - chunk.start
  const sourceEnd = chunk.chunkStart + chunk.end - chunk.start
  const readEnd = safeParserReadEnd(
    chunk.source,
    sourceStart,
    Math.min(sourceEnd, sourceStart + PARSER_READ_BATCH_CODE_UNITS),
    sourceEnd,
  )
  return readResolvedChunkText(chunk.source, sourceStart, readEnd)
}

export const readTreeSitterInputRange = (
  input: TreeSitterPieceTableInput,
  startIndex: number,
  endIndex: number,
): string => {
  if (endIndex <= startIndex) return ''

  const chunks: string[] = []
  for (const chunk of input.chunks) {
    if (chunk.end <= startIndex) continue
    if (chunk.start >= endIndex) break

    const start = Math.max(startIndex, chunk.start) - chunk.start
    const end = Math.min(endIndex, chunk.end) - chunk.start
    chunks.push(
      readResolvedChunkText(chunk.source, chunk.chunkStart + start, chunk.chunkStart + end),
    )
  }

  return chunks.join('')
}

type PieceSpanBuilder = {
  readonly pieces: TreeSitterSourcePieceSpan[]
  readonly chunks: TreeSitterSourceChunkPayload[]
  readonly emittedChunkIds: Set<string>
  readonly sentChunkLengths?: ReadonlyMap<string, number>
}

const appendPieceSpans = (
  snapshot: PieceTableSnapshot,
  bufferId: PieceBufferId,
  start: number,
  length: number,
  builder: PieceSpanBuilder,
): void => {
  forEachBufferSpan(snapshot.buffers, bufferId, start, start + length, (text, from, to, owner) => {
    appendSourceSpans(text, owner, from, to, builder)
  })
}

const appendSourceSpans = (
  text: string,
  owner: object,
  start: number,
  end: number,
  builder: PieceSpanBuilder,
): void => {
  let offset = start

  while (offset < end) {
    const chunkStart = Math.floor(offset / SOURCE_CHUNK_SIZE) * SOURCE_CHUNK_SIZE
    const chunkLength = Math.min(text.length - chunkStart, SOURCE_CHUNK_SIZE)
    const spanStart = offset - chunkStart
    const spanLength = Math.min(end - offset, chunkLength - spanStart)
    const chunkId = sourceChunkId(owner, chunkStart)

    builder.pieces.push({ chunkId, start: spanStart, length: spanLength })
    appendChunkPayload(text, chunkId, chunkStart, chunkLength, builder)
    offset += spanLength
  }
}

const appendChunkPayload = (
  text: string,
  chunkId: string,
  chunkStart: number,
  chunkLength: number,
  builder: PieceSpanBuilder,
): void => {
  // Physical owners survive append-only growth; forks and copied survivors get new owners.
  if (builder.sentChunkLengths?.get(chunkId) === chunkLength) return
  if (builder.emittedChunkIds.has(chunkId)) return

  builder.emittedChunkIds.add(chunkId)
  builder.chunks.push({ chunkId, text: text.slice(chunkStart, chunkStart + chunkLength) })
}

const sourceChunkId = (owner: object, chunkStart: number): string => {
  let id = sourceOwners.get(owner)
  if (id === undefined) {
    id = nextSourceOwner++
    sourceOwners.set(owner, id)
  }
  return `${id}:${chunkStart}`
}

const ensureDocumentSourceCache = (
  cache: TreeSitterSourceCache,
  documentId: string,
): Map<string, ResolvedTreeSitterSourceChunk> => {
  const existing = cache.get(documentId)
  if (existing) return existing

  const documentCache = new Map<string, ResolvedTreeSitterSourceChunk>()
  cache.set(documentId, documentCache)
  return documentCache
}

const resolveDescriptorChunks = (
  cache: Map<string, ResolvedTreeSitterSourceChunk>,
  descriptor: TreeSitterSourceDescriptor,
): TreeSitterInputChunk[] => {
  cacheChunkPayloads(cache, descriptor.chunks)

  const chunks: TreeSitterInputChunk[] = []
  let documentOffset = 0
  for (const piece of descriptor.pieces) {
    const source = cache.get(piece.chunkId)
    if (!source) throw new Error(`Tree-sitter source chunk "${piece.chunkId}" is missing`)

    chunks.push({
      start: documentOffset,
      end: documentOffset + piece.length,
      chunkStart: piece.start,
      source,
    })
    documentOffset += piece.length
  }

  if (documentOffset !== descriptor.length) throw new Error('Tree-sitter source length mismatch')
  return chunks
}

const keepReferencedChunks = (
  cache: Map<string, ResolvedTreeSitterSourceChunk>,
  descriptor: TreeSitterSourceDescriptor,
): void => {
  const referenced = new Set(descriptor.pieces.map((piece) => piece.chunkId))
  for (const chunkId of cache.keys()) {
    if (!referenced.has(chunkId)) cache.delete(chunkId)
  }
}

const cacheChunkPayloads = (
  cache: Map<string, ResolvedTreeSitterSourceChunk>,
  chunks: readonly TreeSitterSourceChunkPayload[],
): void => {
  for (const chunk of chunks)
    cache.set(chunk.chunkId, { text: chunk.text, length: chunk.text.length })
}

const readResolvedChunkText = (
  chunk: ResolvedTreeSitterSourceChunk,
  start: number,
  end: number,
): string => chunk.text.slice(start, end)

const safeParserReadEnd = (
  chunk: ResolvedTreeSitterSourceChunk,
  start: number,
  end: number,
  maxEnd: number,
): number => {
  if (end >= maxEnd || end <= start) return end

  const lastCodeUnit = readResolvedChunkCodeUnit(chunk, end - 1)
  if (!isHighSurrogate(lastCodeUnit)) return end
  return Math.max(start + 1, end - 1)
}

const readResolvedChunkCodeUnit = (chunk: ResolvedTreeSitterSourceChunk, index: number): number =>
  chunk.text.charCodeAt(index)

const isHighSurrogate = (codeUnit: number): boolean => codeUnit >= 0xd800 && codeUnit <= 0xdbff

const findChunkContaining = (
  chunks: readonly TreeSitterInputChunk[],
  index: number,
): TreeSitterInputChunk | null => {
  let low = 0
  let high = chunks.length - 1

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const chunk = chunks[middle]
    if (!chunk) return null

    if (index < chunk.start) {
      high = middle - 1
      continue
    }

    if (index >= chunk.end) {
      low = middle + 1
      continue
    }

    return chunk
  }

  return null
}

const findChunkContainingWithCursor = (
  input: TreeSitterPieceTableInput,
  index: number,
): TreeSitterInputChunk | null => {
  const cachedIndex = input.lastChunkIndex
  const cached = cachedIndex === undefined ? null : input.chunks[cachedIndex]
  if (cached && index >= cached.start && index < cached.end) return cached

  if (cachedIndex !== undefined) {
    const next = input.chunks[cachedIndex + 1]
    if (next && index >= next.start && index < next.end) {
      input.lastChunkIndex = cachedIndex + 1
      return next
    }
  }

  const chunk = findChunkContaining(input.chunks, index)
  if (chunk) input.lastChunkIndex = input.chunks.indexOf(chunk)
  return chunk
}
