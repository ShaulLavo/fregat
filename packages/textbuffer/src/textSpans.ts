import type { TextPageOwner } from './textPages'

export type TextRange = { readonly start: number; readonly end: number }
export type BufferTextSpan = TextRange & { readonly text: string; readonly owner: TextPageOwner }
export type SparseText = {
  readonly length: number
  readonly retainedLength: number
  readonly spans: readonly BufferTextSpan[]
}

// Construct from UTF-16 units so a survivor cannot retain a substring's backing store.
export function copyTextRange(text: string, start: number, end: number): string {
  const batches: string[] = []
  for (let at = start; at < end; at += 8192) {
    const units = new Uint16Array(Math.min(8192, end - at))
    for (let index = 0; index < units.length; index++) units[index] = text.charCodeAt(at + index)
    batches.push(Reflect.apply(String.fromCharCode, null, units))
  }
  return batches.join('')
}

function* mergeRanges(
  source: readonly TextRange[],
  target: TextRange[],
  start: number,
  width: number,
): Generator<void> {
  const middle = Math.min(start + width, source.length)
  const end = Math.min(middle + width, source.length)
  let left = start
  let right = middle
  for (let at = start; at < end; at++) {
    const takeLeft = right >= end || (left < middle && source[left]!.start <= source[right]!.start)
    target[at] = takeLeft ? source[left++]! : source[right++]!
    if (at % 256 === 255) yield
  }
}

// Sorting and union both yield, including a heavily fragmented original chunk.
export function* unionTextRanges(ranges: TextRange[]): Generator<void, TextRange[]> {
  let source = ranges
  let target: TextRange[] = []
  for (let width = 1; width < ranges.length; width *= 2) {
    for (let start = 0; start < ranges.length; start += width * 2) {
      yield* mergeRanges(source, target, start, width)
    }
    const previous = source
    source = target
    target = previous
    yield
  }
  const union: TextRange[] = []
  for (let index = 0; index < source.length; index++) {
    const range = source[index]!
    const last = union[union.length - 1]
    if (last && range.start <= last.end)
      union[union.length - 1] = { start: last.start, end: Math.max(last.end, range.end) }
    else union.push(range)
    if (index % 256 === 255) yield
  }
  return union
}

export function sparseSpanAt(entry: SparseText, offset: number): BufferTextSpan {
  let low = 0
  let high = entry.spans.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (entry.spans[middle]!.end <= offset) low = middle + 1
    else high = middle
  }
  const span = entry.spans[low]
  if (!span || span.start > offset) throw new RangeError('piece buffer text reclaimed')
  return span
}
