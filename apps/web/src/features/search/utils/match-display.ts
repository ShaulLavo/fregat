import type { WorkspaceSearchMatch } from '@workspace/contracts'

export type SearchMatchDisplay = {
  range?: { end: number; start: number }
  text: string
}

export type SearchMatchDisplayOptions = {
  maxLength?: number
}

const DEFAULT_SEARCH_DISPLAY_LENGTH = 96
const DEFAULT_SEARCH_LEADING_CONTEXT = 24
const MIN_SEARCH_DISPLAY_LENGTH = 16
const SEARCH_ELLIPSIS = '…'

export function searchMatchDisplay(
  match: WorkspaceSearchMatch,
  query: string,
  options: SearchMatchDisplayOptions = {},
): SearchMatchDisplay {
  if (match.kind === 'name') return searchQueryDisplay(match.path, query, options)

  const preview = searchMatchPreview(match)
  const range = searchMatchPreviewRange(match, preview)
  if (range) return searchRangeDisplay(preview, range, options)

  return searchQueryDisplay(preview, query, options)
}

function searchMatchPreview(match: WorkspaceSearchMatch) {
  return match.preview || 'Matched line'
}

export function searchMatchPreviewRange(match: WorkspaceSearchMatch, preview: string) {
  if (match.kind !== 'content') return null
  if (match.column === undefined || match.endColumn === undefined) return null

  const previewStart = match.previewStartColumn ?? 0
  const start = match.column - 1 - previewStart
  const end = match.endColumn - 1 - previewStart
  if (start < 0 || end <= start) return null
  if (start >= preview.length) return null

  return { end: Math.min(end, preview.length), start }
}

function searchQueryDisplay(text: string, query: string, options: SearchMatchDisplayOptions) {
  const range = queryRange(text, query)
  if (!range) return { text }

  return searchRangeDisplay(text, range, options)
}

export function queryRange(text: string, query: string) {
  if (!query) return null

  const start = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
  if (start < 0) return null

  return {
    end: start + query.length,
    start,
  }
}

function searchRangeDisplay(
  text: string,
  range: { end: number; start: number },
  options: SearchMatchDisplayOptions,
) {
  const window = searchDisplayWindow(text, range, options.maxLength)
  const prefix = window.start > 0 ? SEARCH_ELLIPSIS : ''
  const suffix = window.end < text.length ? SEARCH_ELLIPSIS : ''
  const windowText = text.slice(window.start, window.end)

  return {
    range: {
      end: prefix.length + range.end - window.start,
      start: prefix.length + range.start - window.start,
    },
    text: `${prefix}${windowText}${suffix}`,
  }
}

function searchDisplayWindow(
  text: string,
  range: { end: number; start: number },
  maxLength: number | undefined,
) {
  const displayLength = normalizedDisplayLength(maxLength, range)
  if (text.length <= displayLength) return { end: text.length, start: 0 }

  const windowLength = searchWindowLength(displayLength, range, text.length)
  const leadingContext = searchLeadingContext(windowLength, range)
  const initialStart = Math.max(0, range.start - leadingContext)
  const start = searchWindowStart(initialStart, range, windowLength)

  return {
    end: Math.min(text.length, start + windowLength),
    start,
  }
}

function normalizedDisplayLength(
  maxLength: number | undefined,
  range: { end: number; start: number },
) {
  const requestedLength =
    maxLength === undefined || !Number.isFinite(maxLength)
      ? DEFAULT_SEARCH_DISPLAY_LENGTH
      : maxLength
  const matchLength = searchRangeLength(range)
  const minimumLength = matchLength + SEARCH_ELLIPSIS.length * 2

  return Math.max(MIN_SEARCH_DISPLAY_LENGTH, minimumLength, Math.floor(requestedLength))
}

function searchWindowLength(
  displayLength: number,
  range: { end: number; start: number },
  textLength: number,
) {
  const prefixLength = range.start > 0 ? SEARCH_ELLIPSIS.length : 0
  const suffixLength = range.end < textLength ? SEARCH_ELLIPSIS.length : 0

  return Math.max(searchRangeLength(range), displayLength - prefixLength - suffixLength)
}

function searchLeadingContext(windowLength: number, range: { end: number; start: number }) {
  const contextLength = Math.max(0, windowLength - searchRangeLength(range))

  return Math.min(DEFAULT_SEARCH_LEADING_CONTEXT, Math.floor(contextLength * 0.35))
}

function searchWindowStart(
  initialStart: number,
  range: { end: number; start: number },
  windowLength: number,
) {
  if (range.end <= initialStart + windowLength) return initialStart

  return Math.max(0, range.end - windowLength)
}

function searchRangeLength(range: { end: number; start: number }) {
  return Math.max(0, range.end - range.start)
}
