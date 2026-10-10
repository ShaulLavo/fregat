export const rowStorage = Symbol('rowStorage')

export interface RowPacket {
  readonly byteLength: number
}

export interface RecordRowStorage {
  readonly kind: 'packed' | 'text'
  readonly packet: RowPacket
  readonly words: Uint32Array
  readonly graphemes: Uint32Array
  readonly graphemeStart: number
  readonly graphemeLength: number
  readonly liveBytes: number
}

interface AsciiRowStorage {
  readonly kind: 'ascii'
  readonly packet: RowPacket
  readonly blanks: Uint32Array
  readonly start: number
  readonly text: string
  readonly liveBytes: number
}

export type RowStorage = RecordRowStorage | AsciiRowStorage

export function recordRowStorage(
  kind: RecordRowStorage['kind'],
  words: Uint32Array,
  graphemes: Uint32Array,
  packet: RowPacket,
): RecordRowStorage {
  const cellWords = kind === 'packed' ? 6 : 3
  const startWord = kind === 'packed' ? 4 : 1
  let start = graphemes.length
  let end = 0
  if (graphemes.length !== 0) {
    for (let offset = 0; offset < words.length; offset += cellWords) {
      const length = words[offset + startWord + 1]!
      if (length === 0) continue
      start = Math.min(start, words[offset + startWord]!)
      end = Math.max(end, words[offset + startWord]! + length)
    }
  }
  // Native extraction places each row's graphemes consecutively in cell order.
  const graphemeLength = end === 0 ? 0 : end - start
  return {
    kind,
    packet,
    words,
    graphemes,
    graphemeStart: start,
    graphemeLength,
    liveBytes: words.byteLength + graphemeLength * 4,
  }
}

export function recordPacket(words: Uint32Array, graphemes: Uint32Array): RowPacket {
  const byteLength = words.buffer.byteLength
  return {
    byteLength: byteLength + (words.buffer === graphemes.buffer ? 0 : graphemes.buffer.byteLength),
  }
}
