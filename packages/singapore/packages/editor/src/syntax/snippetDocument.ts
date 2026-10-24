import {
  createPieceTableSnapshot,
  normalizeDocumentText,
  type PieceTableSnapshot,
} from '@singapore-editor/textbuffer'

import type { DocumentTextSnapshot } from '../documentTextSnapshot'
import { createEditorSnapshotBuffer, type EditorTextBuffer } from '../documentSession'
import type { EditorToken } from '../tokens'
import { toEditorTokenStore, type EditorTokenInput } from './tokenStore'

// A highlighter (Shiki) splits lines itself, so it reads the text as submitted. A parser needs the
// line breaks an opened document has, so it reads the text folded the way the editor ingests it.
export type SnippetLines = 'as-submitted' | 'as-document'

export type SnippetDocument = {
  readonly buffer: EditorTextBuffer
  readonly snapshot: PieceTableSnapshot
  readonly textSnapshot: DocumentTextSnapshot
  /** A session's tokens over this document, as offsets into exactly the submitted text. */
  submittedTokens(tokens: EditorTokenInput): EditorToken[]
}

const BYTE_ORDER_MARK = 0xfeff

export function createSnippetDocument(text: string, lines: SnippetLines): SnippetDocument {
  if (lines === 'as-submitted') return snippetDocument(text, { normalized: true }, [])

  const ingested = normalizeDocumentText(text)
  const options = {
    normalized: true,
    lineEnding: ingested.lineEnding,
    byteOrderMark: ingested.byteOrderMark,
    containsUnusualLineTerminators: ingested.containsUnusualLineTerminators,
  }
  return snippetDocument(ingested.text, options, foldedAwayUnits(text))
}

function snippetDocument(
  text: string,
  options: Parameters<typeof createPieceTableSnapshot>[1],
  removed: readonly number[],
): SnippetDocument {
  const snapshot = createPieceTableSnapshot(text, options)
  const buffer = createEditorSnapshotBuffer(snapshot)
  return {
    buffer,
    snapshot: buffer.getSnapshot(),
    textSnapshot: buffer.getTextSnapshot(),
    submittedTokens: (tokens) => toSubmitted(toEditorTokenStore(tokens).toTokens(), removed),
  }
}

/**
 * Ascending folded offsets from which one more submitted unit lies behind: a stripped byte order
 * mark at 0, and each CRLF's CR just past its kept LF. Lone CR and U+2028/U+2029 keep their width.
 */
function foldedAwayUnits(text: string): number[] {
  const removed: number[] = []
  if (text.charCodeAt(0) === BYTE_ORDER_MARK) removed.push(0)
  let index = text.indexOf('\r\n', removed.length)
  while (index !== -1) {
    removed.push(index - removed.length + 1)
    index = text.indexOf('\r\n', index + 2)
  }
  return removed
}

// Rewrites the fresh tokens in place. The cursor only steps between neighbouring queries, so a
// sorted token list maps in one linear pass.
function toSubmitted(tokens: EditorToken[], removed: readonly number[]): EditorToken[] {
  if (removed.length === 0) return tokens
  let behind = 0
  const submitted = (offset: number): number => {
    while (behind < removed.length && removed[behind]! <= offset) behind += 1
    while (behind > 0 && removed[behind - 1]! > offset) behind -= 1
    return offset + behind
  }
  for (const token of tokens) {
    token.start = submitted(token.start)
    token.end = submitted(token.end)
  }
  return tokens
}
