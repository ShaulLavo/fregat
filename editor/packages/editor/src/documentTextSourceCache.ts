import type { TextPageOwner } from '@singapore-editor/textbuffer/internal/textPages'
import { TextSourceIndex, type MeasuredTextRange } from './textMeasurements'

const SOURCE_PAGE_LENGTH = 16 * 1024
type CachedRange = {
  readonly start: number
  readonly end: number
  readonly source: TextSourceIndex
}
const sourcePages = new WeakMap<object, Map<number, CachedRange[]>>()

// Pages borrow until storage maintenance retires their backing; sparse spans already own it.
export function appendDocumentTextMeasurements(
  ranges: MeasuredTextRange[],
  owner: TextPageOwner,
  text: string,
  start: number,
  end: number,
): void {
  let pages = sourcePages.get(owner)
  if (!pages) {
    pages = new Map()
    sourcePages.set(owner, pages)
  }
  for (let offset = start; offset < end;) {
    const pageStart = Math.floor(offset / SOURCE_PAGE_LENGTH) * SOURCE_PAGE_LENGTH
    const to = Math.min(end, pageStart + SOURCE_PAGE_LENGTH)
    const cached = pages.get(pageStart) ?? []
    const source = measuredSource(cached, owner, text, offset, to)
    pages.set(pageStart, cached)
    ranges.push({ source, start: 0, end: to - offset })
    offset = to
  }
}

function measuredSource(
  cached: CachedRange[],
  owner: TextPageOwner,
  text: string,
  start: number,
  end: number,
): TextSourceIndex {
  const found = cached.find((range) => range.start === start && range.end === end)
  if (found) return found.source
  const source = new TextSourceIndex(owner.page(text, start, end))
  // An insertion splits one original page into two reusable ranges; cap boundary variants.
  if (cached.length === 2) cached.shift()
  cached.push({ start, end, source })
  return source
}
