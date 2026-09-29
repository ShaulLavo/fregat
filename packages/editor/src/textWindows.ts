import type { TextReadSnapshot } from './documentTextSnapshot'

// Scans read at most this many UTF-16 units per copy, so no scan holds a line or document string.
const TEXT_WINDOW_LENGTH = 16_384

const BLOCK_CACHE_SIZE = 4

/** Visits `[start, end)` front to back in bounded windows; `visit` returns false to stop early. */
export function forEachTextWindow(
  source: TextReadSnapshot,
  start: number,
  end: number,
  visit: (text: string, offset: number) => boolean | void,
): void {
  for (let offset = start; offset < end; offset += TEXT_WINDOW_LENGTH) {
    const text = source.readRange(offset, Math.min(end, offset + TEXT_WINDOW_LENGTH))
    if (visit(text, offset) === false) return
  }
}

/** Visits `[start, end)` back to front in bounded windows; `visit` returns false to stop early. */
export function forEachTextWindowBackward(
  source: TextReadSnapshot,
  start: number,
  end: number,
  visit: (text: string, offset: number) => boolean | void,
): void {
  for (let windowEnd = end; windowEnd > start; windowEnd -= TEXT_WINDOW_LENGTH) {
    const offset = Math.max(start, windowEnd - TEXT_WINDOW_LENGTH)
    if (visit(source.readRange(offset, windowEnd), offset) === false) return
  }
}

/**
 * Character access over a snapshot for scans that look back at nearby lines. Aligned blocks are read
 * once and a few are kept, so a sequential scan copies each block of what it touches exactly once.
 */
export class TextBlockReader {
  readonly length: number
  private readonly blocks = new Map<number, string>()

  constructor(private readonly source: TextReadSnapshot) {
    this.length = source.length
  }

  charCodeAt(offset: number): number {
    if (offset < 0 || offset >= this.length) return Number.NaN

    const index = Math.floor(offset / TEXT_WINDOW_LENGTH)
    return this.block(index).charCodeAt(offset - index * TEXT_WINDOW_LENGTH)
  }

  private block(index: number): string {
    const cached = this.blocks.get(index)
    if (cached !== undefined) {
      this.blocks.delete(index)
      this.blocks.set(index, cached)
      return cached
    }

    const start = index * TEXT_WINDOW_LENGTH
    const text = this.source.readRange(start, Math.min(this.length, start + TEXT_WINDOW_LENGTH))
    if (this.blocks.size === BLOCK_CACHE_SIZE) {
      const oldest = this.blocks.keys().next().value
      if (oldest !== undefined) this.blocks.delete(oldest)
    }
    this.blocks.set(index, text)
    return text
  }
}

/**
 * The whitespace run starting at `start`, read no further than `end` or the first other character.
 * Windows start small and grow, since an indent is usually a few characters of a long line.
 */
export function readLeadingWhitespace(
  source: TextReadSnapshot,
  start: number,
  end: number,
): string {
  let result = ''
  let offset = start
  for (let size = 64; offset < end; size = Math.min(size * 4, TEXT_WINDOW_LENGTH)) {
    const text = source.readRange(offset, Math.min(end, offset + size))
    const length = whitespaceLength(text)
    result += text.slice(0, length)
    if (length < text.length) return result
    offset += text.length
  }
  return result
}

function whitespaceLength(text: string): number {
  let index = 0
  while (index < text.length) {
    const code = text.charCodeAt(index)
    if (code !== 0x20 && code !== 0x09) break
    index += 1
  }
  return index
}
