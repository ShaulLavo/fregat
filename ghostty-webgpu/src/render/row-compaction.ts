import { PackedCells } from '../core/packed-cells.js'
import { rowStorage, type RowPacket, type RowStorage } from '../core/row-storage.js'
import { copiedAsciiRow, copiedTextRow } from '../core/text-row-reader.js'
import { compactedFrameRow } from './frame-row.js'
import type { RendererFrameRow, RendererTextFrameRow } from './renderer.js'

// Two live grids amortize copies while bounding packets pinned by unchanged rows.
const PINNED_GRID_MULTIPLIER = 2

type StoredRow = RendererTextFrameRow & { readonly [rowStorage]?: RowStorage }

function recordWords(storage: RowStorage): number {
  return storage.kind === 'ascii' ? Math.ceil(storage.text.length / 32) : storage.words.length
}

function compactPackedRow(
  y: number,
  words: Uint32Array,
  graphemes: Uint32Array,
  packet: RowPacket,
  text: string,
): RendererFrameRow {
  const packed = new PackedCells(words, graphemes, packet)
  return compactedFrameRow(
    {
      y,
      dirty: false,
      packed,
      get cells() {
        return packed.materialize()
      },
    },
    text,
  )
}

function copyRecords(
  storage: Exclude<RowStorage, { kind: 'ascii' }>,
  words: Uint32Array,
  graphemes: Uint32Array,
  graphemeOffset: number,
): void {
  words.set(storage.words)
  graphemes.set(
    storage.graphemes.subarray(
      storage.graphemeStart,
      storage.graphemeStart + storage.graphemeLength,
    ),
    graphemeOffset,
  )
  if (storage.graphemeLength === 0) return
  const cellWords = storage.kind === 'packed' ? 6 : 3
  const startWord = storage.kind === 'packed' ? 4 : 1
  const adjustment = graphemeOffset - storage.graphemeStart
  for (let offset = 0; offset < words.length; offset += cellWords) {
    if (words[offset + startWord + 1] === 0) continue
    words[offset + startWord]! += adjustment
  }
}

function copyAscii(
  storage: Extract<RowStorage, { kind: 'ascii' }>,
  words: Uint32Array,
  bytes: Uint8Array,
  decoder: TextDecoder,
): string {
  for (let column = 0; column < storage.text.length; column += 1) {
    const index = storage.start + column
    if ((storage.blanks[index >>> 5]! & (1 << (index & 31))) !== 0)
      words[column >>> 5]! |= 1 << (column & 31)
    bytes[column] = storage.text.charCodeAt(column)
  }
  // Decoding row-local bytes releases sliced strings' original packet ownership.
  return decoder.decode(bytes.subarray(0, storage.text.length))
}

export function compactRows(
  rows: (RendererFrameRow | undefined)[],
): (RendererFrameRow | undefined)[]
export function compactRows(
  rows: (RendererTextFrameRow | undefined)[],
): (RendererTextFrameRow | undefined)[]
export function compactRows(rows: (StoredRow | undefined)[]): (StoredRow | undefined)[] {
  const packets = new Set<RowPacket>()
  let pinnedBytes = 0
  let liveBytes = 0
  for (const row of rows) {
    const storage = row?.[rowStorage]
    if (!storage) continue
    liveBytes += storage.liveBytes
    if (!packets.has(storage.packet)) {
      packets.add(storage.packet)
      pinnedBytes += storage.packet.byteLength
    }
  }
  if (pinnedBytes <= PINNED_GRID_MULTIPLIER * liveBytes) return rows
  let recordsLength = 0
  let graphemesLength = 0
  let asciiCharacters = 0
  let asciiWidth = 0
  for (const row of rows) {
    const storage = row?.[rowStorage]
    if (!storage) continue
    recordsLength += recordWords(storage)
    if (storage.kind === 'ascii') {
      asciiCharacters += storage.text.length
      asciiWidth = Math.max(asciiWidth, storage.text.length)
      continue
    }
    graphemesLength += storage.graphemeLength
  }
  const owned = new Uint32Array(recordsLength + graphemesLength)
  const graphemes = owned.subarray(recordsLength)
  const packet = { byteLength: owned.byteLength + asciiCharacters * 2 }
  const bytes = new Uint8Array(asciiWidth)
  const decoder = new TextDecoder()
  let wordOffset = 0
  let graphemeOffset = 0
  return rows.map((row) => {
    const storage = row?.[rowStorage]
    if (!row || !storage) return row
    const words = owned.subarray(wordOffset, wordOffset + recordWords(storage))
    wordOffset += words.length
    if (storage.kind === 'ascii')
      return copiedAsciiRow(row.y, copyAscii(storage, words, bytes, decoder), words, 0, packet)
    copyRecords(storage, words, graphemes, graphemeOffset)
    graphemeOffset += storage.graphemeLength
    if (storage.kind === 'text') return copiedTextRow(row.y, words, graphemes, packet)
    return compactPackedRow(row.y, words, graphemes, packet, row.text)
  })
}
