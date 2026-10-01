import { createPieceTableSnapshot } from '@singapore-editor/textbuffer'

import { createDocumentTextSnapshot } from '../documentTextSnapshot'
import type { EditorToken } from '../tokens'
import { toEditorTokenStore, type EditorTokenInput } from './tokenStore'

/**
 * Text that is not the document, opened as one so a syntax session can tokenize it. A document
 * holds LF line ends, so each CRLF folds to LF; any other CR stays line text, as Shiki splits
 * lines. Tokens come back as offsets into exactly the text submitted.
 */
export function createSnippetDocument(text: string) {
  const breaks = foldedCrlfBreaks(text)
  const folded = breaks.length === 0 ? text : text.replaceAll('\r\n', '\n')
  const snapshot = createPieceTableSnapshot(folded, { normalized: true })
  return {
    snapshot,
    textSnapshot: createDocumentTextSnapshot(snapshot, folded),
    submittedTokens: (tokens: EditorTokenInput): EditorToken[] =>
      submittedOffsets(toEditorTokenStore(tokens).toTokens(), breaks),
  }
}

/** Where each folded LF that was a CRLF sits in the folded text, ascending. */
function foldedCrlfBreaks(text: string): number[] {
  const breaks: number[] = []
  let index = text.indexOf('\r\n')
  while (index !== -1) {
    breaks.push(index - breaks.length)
    index = text.indexOf('\r\n', index + 2)
  }
  return breaks
}

function submittedOffsets(tokens: EditorToken[], breaks: readonly number[]): EditorToken[] {
  if (breaks.length === 0) return tokens
  return tokens.map((token) => ({
    ...token,
    start: submittedOffset(token.start, breaks),
    end: submittedOffset(token.end, breaks),
  }))
}

// Each CR folded away before `offset` moves it one unit later in the submitted text.
function submittedOffset(offset: number, breaks: readonly number[]): number {
  let low = 0
  let high = breaks.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (breaks[middle]! < offset) low = middle + 1
    else high = middle
  }
  return offset + low
}
