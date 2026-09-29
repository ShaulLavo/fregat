// Documents are stored LF-only, always. The line ending a document arrived
// with is recorded on the buffers so a host can round-trip it on save, but
// nothing downstream of ingestion ever sees a '\r' that terminates a line.
//
// This invariant is load-bearing: buffer line indexes scan for '\n' alone
// (buffers.ts), and the view derives a line end as `nextLineStart - 1`
// (virtualizedTextViewModel.ts). Without normalization a CRLF checkout puts a
// stray CR *inside* every rendered line, so End lands a column too far,
// selections and gutter widths are off by one, and the CR reaches the DOM.
// Normalizing once here is what keeps every one of those consumers correct
// without each re-solving it. U+2028/U+2029 are folded for the same reason from
// the other direction: they are line breaks to CSS but not to us.

export type DocumentLineEnding = '\n' | '\r\n'

export type DocumentTextRoundTripIssue =
  | 'mixed-line-endings'
  | 'lone-carriage-return'
  | 'unusual-line-terminator'

export type DocumentTextRoundTripStatus =
  | {
      readonly hasByteOrderMark: boolean
      readonly lineEnding: DocumentLineEnding
      readonly ok: true
    }
  | { readonly issues: readonly DocumentTextRoundTripIssue[]; readonly ok: false }

export const UTF8_BYTE_ORDER_MARK = '﻿'

export const DEFAULT_DOCUMENT_LINE_ENDING: DocumentLineEnding = '\n'

export type NormalizedDocumentText = {
  readonly text: string
  readonly lineEnding: DocumentLineEnding
  readonly byteOrderMark: string
  // U+2028/U+2029 were present and have been folded into the text above, so the
  // document a host saves back is no longer byte-identical to the one it handed
  // us. Decided once during ingestion, which is why every later content change
  // can ignore the question.
  readonly containsUnusualLineTerminators: boolean
}

const CARRIAGE_RETURN = 0x0d
const LINE_FEED = 0x0a
const LINE_SEPARATOR = 0x2028
const PARAGRAPH_SEPARATOR = 0x2029
const BYTE_ORDER_MARK = 0xfeff
const LINE_TERMINATOR_PROBE = /[\r\u2028\u2029]/
const LINE_TERMINATORS = /\r\n|[\r\u2028\u2029]/g

type LineTerminatorScan = {
  readonly lineEnding: DocumentLineEnding
  readonly containsUnusualLineTerminators: boolean
}

// One pass over the document decides both answers. U+2028/U+2029 are counted
// only as a flag, never as a vote: a Word paste dropped into a CRLF file must
// not flip what that file is saved as.
const scanLineTerminators = (text: string, fallback: DocumentLineEnding): LineTerminatorScan => {
  if (!LINE_TERMINATOR_PROBE.test(text))
    return {
      lineEnding: text.includes('\n') ? '\n' : fallback,
      containsUnusualLineTerminators: false,
    }

  let carriageReturns = 0
  let lineFeeds = 0
  let pairs = 0
  let unusual = false

  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code === CARRIAGE_RETURN && text.charCodeAt(index + 1) === LINE_FEED) {
      pairs++
      index++
      continue
    }
    if (code === CARRIAGE_RETURN) {
      carriageReturns++
      continue
    }
    if (code === LINE_FEED) {
      lineFeeds++
      continue
    }
    if (code === LINE_SEPARATOR || code === PARAGRAPH_SEPARATOR) unusual = true
  }

  const total = carriageReturns + lineFeeds + pairs
  const majorityCarriageReturn = carriageReturns + pairs > total / 2
  const lineEnding = majorityCarriageReturn ? '\r\n' : '\n'
  return {
    lineEnding: total === 0 ? fallback : lineEnding,
    containsUnusualLineTerminators: unusual,
  }
}

// Majority vote over the terminators actually present: a document is CRLF only
// when more than half its line endings carry a CR. Mixed-ending files therefore
// normalize to whichever form dominates rather than to whichever appeared first.
export const detectDocumentLineEnding = (
  text: string,
  fallback: DocumentLineEnding = DEFAULT_DOCUMENT_LINE_ENDING,
): DocumentLineEnding => scanLineTerminators(text, fallback).lineEnding

// Collapses CRLF and lone CR to LF. Lone CR counts as a terminator because
// classic-Mac and mis-transcoded files use it, and leaving it in would make it
// an invisible in-line character rather than a line break.
//
// U+2028/U+2029 collapse for the mirror-image reason. They arrive from JSON
// string literals and from Word/PDF pastes, and CSS `white-space: pre` — which
// is how rows are painted — treats them as forced breaks while the model counts
// only '\n'. One left in the text makes a model row occupy two visual lines, so
// its measured height, offsetToX, hit testing and selection rects all describe
// geometry the model does not know exists.
export const normalizeLineEndings = (text: string): string =>
  LINE_TERMINATOR_PROBE.test(text) ? text.replace(LINE_TERMINATORS, '\n') : text

export const applyDocumentLineEnding = (text: string, lineEnding: DocumentLineEnding): string =>
  lineEnding === '\n' ? text : text.replace(/\n/g, '\r\n')

export const hasByteOrderMark = (text: string): boolean => text.charCodeAt(0) === BYTE_ORDER_MARK

export const documentTextRoundTripStatus = (text: string): DocumentTextRoundTripStatus => {
  const byteOrderMark = hasByteOrderMark(text)
  const body = byteOrderMark ? text.slice(1) : text
  const facts = scanRoundTripTerminators(body)
  const issues: DocumentTextRoundTripIssue[] = []
  const endingKinds = Number(facts.lineFeeds > 0) + Number(facts.pairs > 0) + Number(facts.lone > 0)

  if (endingKinds > 1) issues.push('mixed-line-endings')
  if (facts.lone > 0) issues.push('lone-carriage-return')
  if (facts.unusual) issues.push('unusual-line-terminator')
  if (issues.length > 0) return { ok: false, issues }

  return {
    hasByteOrderMark: byteOrderMark,
    lineEnding: facts.pairs > 0 ? '\r\n' : '\n',
    ok: true,
  }
}

function scanRoundTripTerminators(text: string): {
  readonly lineFeeds: number
  readonly lone: number
  readonly pairs: number
  readonly unusual: boolean
} {
  let lineFeeds = 0
  let lone = 0
  let pairs = 0
  let unusual = false
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code === CARRIAGE_RETURN && text.charCodeAt(index + 1) === LINE_FEED) {
      pairs += 1
      index += 1
      continue
    }
    if (code === CARRIAGE_RETURN) {
      lone += 1
      continue
    }
    if (code === LINE_FEED) {
      lineFeeds += 1
      continue
    }
    if (code === LINE_SEPARATOR || code === PARAGRAPH_SEPARATOR) unusual = true
  }
  return { lineFeeds, lone, pairs, unusual }
}

// Ingestion boundary: strip a leading BOM into its own field and flatten line
// endings, reporting what was found so the host can restore both on save.
export const normalizeDocumentText = (
  text: string,
  fallback: DocumentLineEnding = DEFAULT_DOCUMENT_LINE_ENDING,
): NormalizedDocumentText => {
  const byteOrderMark = hasByteOrderMark(text) ? UTF8_BYTE_ORDER_MARK : ''
  const body = byteOrderMark === '' ? text : text.slice(1)
  const scan = scanLineTerminators(body, fallback)
  return {
    text: normalizeLineEndings(body),
    lineEnding: scan.lineEnding,
    byteOrderMark,
    containsUnusualLineTerminators: scan.containsUnusualLineTerminators,
  }
}
