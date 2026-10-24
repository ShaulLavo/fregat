import type { InlineMap } from './inlineMap'
import type { TextOffsetRange } from './textRanges'

/** Sorted by start and disjoint, as the inline map keeps its replacements. */
export type AtomicRanges = readonly TextOffsetRange[]

const EMPTY: AtomicRanges = []
const atomicRangesByMap = new WeakMap<InlineMap, AtomicRanges>()

/** The spans of a rendered map that no caret may rest inside and no delete may split. */
export function atomicRangesForInlineMap(map: InlineMap | null): AtomicRanges {
  if (!map) return EMPTY
  const cached = atomicRangesByMap.get(map)
  if (cached) return cached

  const ranges: TextOffsetRange[] = []
  for (const range of map.ranges) {
    if (range.atomic !== true || range.insertion === true) continue
    ranges.push({ start: range.startOffset, end: range.endOffset })
  }
  const result = ranges.length === 0 ? EMPTY : ranges
  atomicRangesByMap.set(map, result)
  return result
}

/** The first range whose end is at or after `offset`, by binary search. */
function firstEndingAtOrAfter(ranges: AtomicRanges, offset: number): number {
  let low = 0
  let high = ranges.length
  while (low < high) {
    const middle = (low + high) >>> 1
    const range = ranges[middle]
    if (range && range.end < offset) low = middle + 1
    else high = middle
  }
  return low
}

/** The range holding `offset` strictly between its edges. */
function atomicRangeAround(ranges: AtomicRanges, offset: number): TextOffsetRange | null {
  const range = ranges[firstEndingAtOrAfter(ranges, offset)]
  if (!range || range.start >= offset || range.end <= offset) return null
  return range
}

/** Moves an offset that landed inside a range to the edge the motion was heading for. */
export function atomicCaretOffset(ranges: AtomicRanges, offset: number, direction: -1 | 1): number {
  const range = atomicRangeAround(ranges, offset)
  if (!range) return offset
  return direction < 0 ? range.start : range.end
}

/**
 * The span a one-step delete from a caret removes when it starts on a range's edge: Backspace at
 * its end or Delete at its start takes all of it.
 */
export function atomicDeleteRange(
  ranges: AtomicRanges,
  caret: number,
  direction: 'backward' | 'forward',
): TextOffsetRange | null {
  const range = ranges[firstEndingAtOrAfter(ranges, caret)]
  if (!range) return null
  if (direction === 'backward') return range.start < caret && caret <= range.end ? range : null
  return range.start <= caret && caret < range.end ? range : null
}

/** Grows a delete span over every range it would otherwise cut into. */
export function widenOverAtomicRanges(
  ranges: AtomicRanges,
  span: TextOffsetRange,
): TextOffsetRange {
  let { start, end } = span
  for (let index = firstEndingAtOrAfter(ranges, start); index < ranges.length; index += 1) {
    const range = ranges[index]
    if (!range || range.start >= end) break
    if (range.end <= start) continue
    start = Math.min(start, range.start)
    end = Math.max(end, range.end)
  }
  return start === span.start && end === span.end ? span : { start, end }
}
