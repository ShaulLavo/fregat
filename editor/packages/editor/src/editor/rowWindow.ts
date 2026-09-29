import type { TextReadSnapshot } from '../documentTextSnapshot'
import { MAX_BOUNDARY_WINDOW } from '../graphemes'
import type { TextOffsetRange } from '../textRanges'

/**
 * How far a word scan may read past the offset it stops at: the grapheme search's widest window.
 * A window is trusted only where the scan stopped at least this far inside it.
 */
const WORD_SCAN_REACH = MAX_BOUNDARY_WINDOW
const FIRST_REACH = 2 * WORD_SCAN_REACH

/**
 * Runs a word scan over the offset's row and its breaks, widening until the result is settled.
 * No word scan crosses a break, so the row bounds every window.
 */
export function rangeInRowWindow(
  source: TextReadSnapshot,
  offset: number,
  scan: (text: string, offset: number) => TextOffsetRange,
): TextOffsetRange {
  const line = source.lineRange(source.lineAt(offset))
  const first = Math.max(0, line.start - 1)
  const last = Math.min(source.length, line.end + 1)

  for (let reach = FIRST_REACH; ; reach *= 4) {
    const start = Math.max(first, offset - reach)
    const end = Math.min(last, offset + reach)
    const text = source.readRange(start, end)
    const range = scan(text, offset - start)
    const settledStart = start === first || range.start >= WORD_SCAN_REACH
    const settledEnd = end === last || text.length - range.end >= WORD_SCAN_REACH
    if (settledStart && settledEnd) return { start: start + range.start, end: start + range.end }
  }
}
