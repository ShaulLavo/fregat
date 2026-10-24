import type * as lsp from 'vscode-languageserver-protocol'
import { recordLspPerformanceDiagnostic } from './performanceDiagnostics'
import type { LspLineStarts, LspTextDocumentSnapshot, LspTextEdit } from './types'

export type LspContentChangeOptions = {
  readonly incremental?: boolean
  readonly edits?: readonly LspTextEdit[]
}

export function offsetToLspPosition(text: string, offset: number): lsp.Position {
  if (offset < 0 || offset > text.length) throw new RangeError('invalid offset')

  return positionForOffset(text, offset)
}

export function lspPositionToOffset(text: string, position: lsp.Position): number {
  const lineStart = lineStartForLspLine(text, nonNegativeInteger(position.line))
  return offsetInLine(text, lineStart, nonNegativeInteger(position.character))
}

export function offsetToLspPositionInSnapshot(
  document: LspTextDocumentSnapshot,
  offset: number,
): lsp.Position {
  if (offset < 0 || offset > document.textSnapshot.length) throw new RangeError('invalid offset')

  const line = rowForOffset(document.lineStarts, offset)
  const lineStart = lineStartForSnapshotLine(document, line)
  const lineEnd = lineEndOffsetInSnapshot(document, line)
  return { line, character: Math.min(offset, lineEnd) - lineStart }
}

export function lspPositionToOffsetInSnapshot(
  document: LspTextDocumentSnapshot,
  position: lsp.Position,
): number {
  const line = snapshotLineForLspLine(document, nonNegativeInteger(position.line))
  const lineStart = lineStartForSnapshotLine(document, line)
  const lineEnd = lineEndOffsetInSnapshot(document, line)
  return Math.min(lineStart + nonNegativeInteger(position.character), lineEnd)
}

export const textEditToLspContentChange = (
  previousText: string,
  edit: LspTextEdit,
): lsp.TextDocumentContentChangeEvent => {
  validateTextEdit(previousText, edit)
  return {
    range: lspRangeForTextEdit(previousText, edit),
    text: edit.text,
  }
}

export const textEditsToLspContentChanges = (
  previousText: string,
  edits: readonly LspTextEdit[],
): readonly lsp.TextDocumentContentChangeEvent[] => {
  if (edits.length === 0) return []
  if (!areValidBatchEdits(previousText, edits)) return []

  const changes: lsp.TextDocumentContentChangeEvent[] = []

  for (const edit of edits.toSorted(compareTextEditsDescending)) {
    changes.push({
      range: lspRangeForTextEdit(previousText, edit),
      text: edit.text,
    })
  }

  return changes
}

export const textEditToLspContentChangeInSnapshot = (
  previousDocument: LspTextDocumentSnapshot,
  edit: LspTextEdit,
): lsp.TextDocumentContentChangeEvent => {
  validateTextEditForLength(previousDocument.textSnapshot.length, edit)
  return {
    range: lspRangeForTextEditInSnapshot(previousDocument, edit),
    text: edit.text,
  }
}

export const textEditsToLspContentChangesInSnapshot = (
  previousDocument: LspTextDocumentSnapshot,
  edits: readonly LspTextEdit[],
): readonly lsp.TextDocumentContentChangeEvent[] => {
  if (edits.length === 0) return []
  if (!areValidBatchEditsForLength(previousDocument.textSnapshot.length, edits)) return []

  const changes: lsp.TextDocumentContentChangeEvent[] = []

  for (const edit of edits.toSorted(compareTextEditsDescending)) {
    changes.push({
      range: lspRangeForTextEditInSnapshot(previousDocument, edit),
      text: edit.text,
    })
  }

  return changes
}

export const createLspContentChanges = (
  previousText: string,
  nextText: string,
  options: LspContentChangeOptions = {},
): readonly lsp.TextDocumentContentChangeEvent[] => {
  if (!options.incremental) return [createFullContentChange(nextText)]
  if (!options.edits || options.edits.length === 0) return [createFullContentChange(nextText)]

  const changes = textEditsToLspContentChanges(previousText, options.edits)
  const editedText = applyTextEdits(previousText, options.edits)
  if (changes.length === 0 || editedText !== nextText) return [createFullContentChange(nextText)]

  return changes
}

export const createLspContentChangesInSnapshot = (
  previousDocument: LspTextDocumentSnapshot,
  nextDocument: LspTextDocumentSnapshot,
  options: LspContentChangeOptions = {},
): readonly lsp.TextDocumentContentChangeEvent[] => {
  if (!options.incremental) return fullSnapshotContentChange(nextDocument, 'full-sync')
  if (!options.edits || options.edits.length === 0) {
    return fullSnapshotContentChange(nextDocument, 'missing-edits')
  }

  const changes = textEditsToLspContentChangesInSnapshot(previousDocument, options.edits)
  if (changes.length === 0) return fullSnapshotContentChange(nextDocument, 'invalid-edits')
  if (!editsMatchNextLength(previousDocument, nextDocument, options.edits)) {
    return fullSnapshotContentChange(nextDocument, 'length-mismatch')
  }

  recordContentChangePath('snapshot-incremental', previousDocument, nextDocument, options.edits)
  return changes
}

const LF = 10
const CR = 13

function positionForOffset(text: string, offset: number): lsp.Position {
  let index = 0
  let line = 0
  let lineStart = 0

  while (index < offset) {
    const code = text.charCodeAt(index)
    if (!(code === LF || code === CR)) {
      index += 1
      continue
    }

    const breakEnd = lineBreakEnd(text, index, code)
    if (offset < breakEnd) return { line, character: index - lineStart }

    index = breakEnd
    lineStart = breakEnd
    line += 1
  }

  return { line, character: offset - lineStart }
}

function lspRangeForTextEdit(text: string, edit: LspTextEdit): lsp.Range {
  let index = 0
  let line = 0
  let lineStart = 0

  function readPosition(offset: number): lsp.Position {
    while (index < offset) {
      const code = text.charCodeAt(index)
      if (!(code === LF || code === CR)) {
        index += 1
        continue
      }

      const breakEnd = lineBreakEnd(text, index, code)
      if (offset < breakEnd) return { line, character: index - lineStart }

      index = breakEnd
      lineStart = breakEnd
      line += 1
    }

    return { line, character: offset - lineStart }
  }

  return {
    start: readPosition(edit.from),
    end: readPosition(edit.to),
  }
}

function lspRangeForTextEditInSnapshot(
  document: LspTextDocumentSnapshot,
  edit: LspTextEdit,
): lsp.Range {
  return {
    start: offsetToLspPositionInSnapshot(document, edit.from),
    end: offsetToLspPositionInSnapshot(document, edit.to),
  }
}

function lineStartForLspLine(text: string, targetLine: number): number {
  let index = 0
  let line = 0
  let lineStart = 0

  while (line < targetLine && index < text.length) {
    const code = text.charCodeAt(index)
    if (!(code === LF || code === CR)) {
      index += 1
      continue
    }

    lineStart = lineBreakEnd(text, index, code)
    index = lineStart
    line += 1
  }

  return lineStart
}

function offsetInLine(text: string, lineStart: number, character: number): number {
  const requestedOffset = lineStart + character
  let index = lineStart

  while (index < requestedOffset && index < text.length) {
    const code = text.charCodeAt(index)
    if (code === LF || code === CR) return index
    index += 1
  }

  return Math.min(requestedOffset, text.length)
}

function lineBreakEnd(text: string, index: number, code: number): number {
  if (code !== CR) return index + 1
  if (text.charCodeAt(index + 1) === LF) return index + 2
  return index + 1
}

function rowForOffset(lineStarts: LspLineStarts, offset: number): number {
  let low = 0
  let high = lineStarts.length - 1
  let row = 0

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const start = lineStarts.at(middle) ?? 0
    if (start <= offset) {
      row = middle
      low = middle + 1
      continue
    }

    high = middle - 1
  }

  return row
}

function snapshotLineForLspLine(document: LspTextDocumentSnapshot, line: number): number {
  if (document.lineStarts.length === 0) return 0
  return Math.min(line, document.lineStarts.length - 1)
}

function lineStartForSnapshotLine(document: LspTextDocumentSnapshot, line: number): number {
  return document.lineStarts.at(line) ?? document.textSnapshot.length
}

function lineEndOffsetInSnapshot(document: LspTextDocumentSnapshot, line: number): number {
  const nextStart = document.lineStarts.at(line + 1)
  if (nextStart === undefined) return document.textSnapshot.length
  if (lineBreakProbe(document, line, nextStart).endsWith('\r\n')) return nextStart - 2
  return Math.max(lineStartForSnapshotLine(document, line), nextStart - 1)
}

function lineBreakProbe(
  document: LspTextDocumentSnapshot,
  line: number,
  nextStart: number,
): string {
  const lineStart = lineStartForSnapshotLine(document, line)
  const probeStart = Math.max(lineStart, nextStart - 2)
  return document.textSnapshot.readRange(probeStart, nextStart)
}

function nonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value))
}

const createFullContentChange = (text: string): lsp.TextDocumentContentChangeEvent => ({ text })

const fullSnapshotContentChange = (
  document: LspTextDocumentSnapshot,
  reason: string,
): readonly lsp.TextDocumentContentChangeEvent[] => {
  recordContentChangePath(reason, document, document, [])
  return [createFullContentChange(fullSyncPayloadText(document))]
}

// Full sync and incremental recovery send the whole document by protocol definition.
function fullSyncPayloadText(document: LspTextDocumentSnapshot): string {
  return document.textSnapshot.readRange(0, document.textSnapshot.length)
}

const applyTextEdits = (text: string, edits: readonly LspTextEdit[]): string | null => {
  if (!areValidBatchEdits(text, edits)) return null

  let nextText = text
  for (const edit of edits.toSorted(compareTextEditsDescending)) {
    nextText = applyTextEdit(nextText, edit)
  }

  return nextText
}

const applyTextEdit = (text: string, edit: LspTextEdit): string =>
  `${text.slice(0, edit.from)}${edit.text}${text.slice(edit.to)}`

const areValidBatchEdits = (text: string, edits: readonly LspTextEdit[]): boolean => {
  let previousEnd = -1
  for (const edit of edits.toSorted(compareTextEditsAscending)) {
    if (!isValidTextEdit(text, edit)) return false
    if (edit.from < previousEnd) return false
    previousEnd = edit.to
  }

  return true
}

const areValidBatchEditsForLength = (length: number, edits: readonly LspTextEdit[]): boolean => {
  let previousEnd = -1
  for (const edit of edits.toSorted(compareTextEditsAscending)) {
    if (!isValidTextEditForLength(length, edit)) return false
    if (edit.from < previousEnd) return false
    previousEnd = edit.to
  }

  return true
}

const validateTextEdit = (text: string, edit: LspTextEdit): void => {
  if (isValidTextEdit(text, edit)) return
  throw new RangeError('invalid text edit')
}

const validateTextEditForLength = (length: number, edit: LspTextEdit): void => {
  if (isValidTextEditForLength(length, edit)) return
  throw new RangeError('invalid text edit')
}

const isValidTextEdit = (text: string, edit: LspTextEdit): boolean =>
  edit.from >= 0 && edit.to >= edit.from && edit.to <= text.length

const isValidTextEditForLength = (length: number, edit: LspTextEdit): boolean =>
  edit.from >= 0 && edit.to >= edit.from && edit.to <= length

const editsMatchNextLength = (
  previousDocument: LspTextDocumentSnapshot,
  nextDocument: LspTextDocumentSnapshot,
  edits: readonly LspTextEdit[],
): boolean => {
  let length = previousDocument.textSnapshot.length
  for (const edit of edits) length += edit.text.length - (edit.to - edit.from)
  return length === nextDocument.textSnapshot.length
}

function recordContentChangePath(
  path: string,
  previousDocument: LspTextDocumentSnapshot,
  nextDocument: LspTextDocumentSnapshot,
  edits: readonly LspTextEdit[],
): void {
  recordLspPerformanceDiagnostic('lsp.contentChanges.path', {
    path,
    editCount: edits.length,
    previousLength: previousDocument.textSnapshot.length,
    nextLength: nextDocument.textSnapshot.length,
  })
}

const compareTextEditsAscending = (left: LspTextEdit, right: LspTextEdit): number =>
  left.from - right.from || left.to - right.to

const compareTextEditsDescending = (left: LspTextEdit, right: LspTextEdit): number =>
  right.from - left.from || right.to - left.to
