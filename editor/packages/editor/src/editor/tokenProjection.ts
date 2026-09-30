import type { TextSnapshot } from '../documentTextSnapshot'
import type { TextEdit } from '../tokens'
import { EditorTokenStore, type EditorTokenRun } from '../syntax/tokenStore'
import type { TextEditBatch, TextEditBatchChange } from '../textEditBatch'
import { recordEditorPerformanceDiagnostic } from './performanceDiagnostics'

type TokenProjectionText = string | TextSnapshot

/** A token's offsets while it is carried through an edit; reused, never retained. */
type TokenSpan = { start: number; end: number }

type TokenWindow = { readonly first: number; readonly last: number }

type TokenRunWriter = {
  readonly starts: Uint32Array
  readonly ends: Uint32Array
  readonly styleIds: Uint32Array
  count: number
}

/**
 * The tokens an edit can touch sit between two bisections; everything after them only shifts,
 * which the store records without visiting it.
 */
export function projectTokensThroughEdit(
  tokens: EditorTokenStore,
  edit: TextEdit,
  previousText: TokenProjectionText,
): EditorTokenStore {
  if (tokens.length === 0) return tokens

  const delta = edit.text.length - (edit.to - edit.from)
  const lineStructureChanged = editChangesLineStructure(edit, previousText)
  const window = tokensTouchedByEdit(tokens, edit.from, edit.to)
  const writer = createTokenRunWriter(window.last - window.first)
  const span: TokenSpan = { start: 0, end: 0 }
  let keepsLiveRanges = true

  tokens.forEachInRange(window.first, window.last, (start, end, styleId) => {
    span.start = start
    span.end = end
    const kept = projectSpanThroughEdit(span, edit, previousText, delta, lineStructureChanged)
    if (kept && span.end > span.start) writeTokenRun(writer, span, styleId)
    else keepsLiveRanges = false
  })

  recordTokenProjection(tokens, window, writer.count, 1)
  return tokens.replaceRange(window.first, window.last, finishTokenRun(writer), {
    delta,
    keepsLiveRanges,
  })
}

export function projectTokensThroughEdits(
  tokens: EditorTokenStore,
  batch: TextEditBatch,
): EditorTokenStore {
  if (tokens.length === 0 || batch.changes.length === 0) return tokens

  const edits = batch.changes.map((change) => ({
    from: change.from,
    to: change.to,
    text: batch.after.readRange(change.afterFrom, change.afterTo),
  }))
  // Back to front, so the indices of the windows still to come are untouched by the ones done.
  let projected = tokens
  let touched = 0
  for (const group of changeGroupsBackToFront(tokens, batch.changes)) {
    const run = projectWindowThroughBatch(tokens, group, batch, edits)
    touched += group.window.last - group.window.first
    projected = projected.replaceRange(group.window.first, group.window.last, run, {
      delta: group.delta,
      keepsLiveRanges: false,
    })
  }

  recordTokenProjection(tokens, { first: 0, last: touched }, projected.length, batch.edits.length)
  return projected
}

export function tokenProjectionLiveRangeStatus(
  sourceTokens: EditorTokenStore,
  projectedTokens: EditorTokenStore,
): boolean | null {
  if (sourceTokens === projectedTokens) return true

  const origin = projectedTokens.derivedFrom
  if (!origin) return null
  if (origin.revision !== sourceTokens.revision) return false
  return origin.keepsLiveRanges
}

type ChangeGroup = {
  readonly window: TokenWindow
  readonly firstChange: number
  readonly lastChange: number
  /** Length change of this group's edits alone; later tokens already carry the rest. */
  readonly delta: number
}

/** Changes whose token windows touch are one group, because one token may span both. */
function changeGroupsBackToFront(
  tokens: EditorTokenStore,
  changes: readonly TextEditBatchChange[],
): ChangeGroup[] {
  const groups: ChangeGroup[] = []
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index]!
    const window = tokensTouchedByEdit(tokens, change.from, change.to)
    const previous = groups[groups.length - 1]
    if (previous && window.first <= previous.window.last) {
      groups[groups.length - 1] = {
        ...previous,
        window: { first: previous.window.first, last: Math.max(previous.window.last, window.last) },
        lastChange: index,
        delta: previous.delta + change.offsetDelta,
      }
      continue
    }

    groups.push({ window, firstChange: index, lastChange: index, delta: change.offsetDelta })
  }
  return groups.reverse()
}

function projectWindowThroughBatch(
  tokens: EditorTokenStore,
  group: ChangeGroup,
  batch: TextEditBatch,
  edits: readonly TextEdit[],
): EditorTokenRun {
  const writer = createTokenRunWriter(group.window.last - group.window.first)
  const span: TokenSpan = { start: 0, end: 0 }

  tokens.forEachInRange(group.window.first, group.window.last, (start, end, styleId) => {
    span.start = start
    span.end = end
    if (!projectSpanThroughGroup(span, group, batch, edits)) return
    if (span.end > span.start) writeTokenRun(writer, span, styleId)
  })
  return finishTokenRun(writer)
}

/**
 * Moves `span` through this group's edits only: earlier groups shift it when the store applies
 * them. False when an edit swallowed the token.
 */
function projectSpanThroughGroup(
  span: TokenSpan,
  group: ChangeGroup,
  batch: TextEditBatch,
  edits: readonly TextEdit[],
): boolean {
  const start = span.start
  const end = span.end
  const step: TokenSpan = { start, end }
  let startDelta = 0
  let endDelta = 0
  for (let index = group.firstChange; index <= group.lastChange; index += 1) {
    const change = batch.changes[index]!
    if (change.from > end) break
    if (change.to < start) {
      startDelta += change.offsetDelta
      endDelta += change.offsetDelta
      continue
    }

    step.start = start
    step.end = end
    const lineChanged =
      change.startRow !== change.endRow || change.afterStartRow !== change.afterEndRow
    if (
      !projectSpanThroughEdit(step, edits[index]!, batch.before, change.offsetDelta, lineChanged)
    ) {
      return false
    }
    startDelta += step.start - start
    endDelta += step.end - end
  }

  span.start = start + startDelta
  span.end = end + endDelta
  return true
}

function tokensTouchedByEdit(tokens: EditorTokenStore, from: number, to: number): TokenWindow {
  const insertion = from === to
  const last = insertion ? tokens.firstStartingAfter(from) : tokens.firstStartingAtOrAfter(to)
  const first = insertion
    ? tokens.firstEndingAtOrAfter(from, last)
    : tokens.firstEndingAfter(from, last)
  return { first, last }
}

function createTokenRunWriter(capacity: number): TokenRunWriter {
  return {
    starts: new Uint32Array(capacity),
    ends: new Uint32Array(capacity),
    styleIds: new Uint32Array(capacity),
    count: 0,
  }
}

function writeTokenRun(writer: TokenRunWriter, span: TokenSpan, styleId: number): void {
  writer.starts[writer.count] = span.start
  writer.ends[writer.count] = span.end
  writer.styleIds[writer.count] = styleId
  writer.count += 1
}

function finishTokenRun(writer: TokenRunWriter): EditorTokenRun {
  return {
    starts: writer.starts.subarray(0, writer.count),
    ends: writer.ends.subarray(0, writer.count),
    styleIds: writer.styleIds.subarray(0, writer.count),
  }
}

function editChangesLineStructure(edit: TextEdit, previousText: TokenProjectionText): boolean {
  if (edit.text.includes('\n')) return true
  if (edit.to <= edit.from) return false
  return getProjectionTextInRange(previousText, edit.from, edit.to).includes('\n')
}

/** Moves `span` through the edit in place. False when the edit swallowed the token. */
function projectSpanThroughEdit(
  span: TokenSpan,
  edit: TextEdit,
  previousText: TokenProjectionText,
  delta: number,
  lineStructureChanged: boolean,
): boolean {
  if (lineStructureChanged) return projectSpanThroughLineEdit(span, edit, delta)
  if (edit.from === edit.to) return projectSpanThroughInsertion(span, edit, previousText)
  if (span.end <= edit.from) return true
  if (span.start >= edit.to) return shiftSpan(span, delta)
  if (!(span.start < edit.from && edit.to < span.end)) return false

  span.end += delta
  return true
}

function projectSpanThroughLineEdit(span: TokenSpan, edit: TextEdit, delta: number): boolean {
  const shift = edit.from === edit.to ? edit.text.length : delta
  const editEnd = edit.from === edit.to ? edit.from : edit.to
  if (span.end <= edit.from) return true
  if (span.start >= editEnd) return shiftSpan(span, shift)
  return false
}

function projectSpanThroughInsertion(
  span: TokenSpan,
  edit: TextEdit,
  previousText: TokenProjectionText,
): boolean {
  if (shouldExpandSpanForInsertion(span, edit, previousText)) {
    span.end += edit.text.length
    return true
  }
  if (span.start >= edit.from) return shiftSpan(span, edit.text.length)
  return true
}

function shouldExpandSpanForInsertion(
  span: TokenSpan,
  edit: TextEdit,
  previousText: TokenProjectionText,
): boolean {
  if (edit.text.length === 0) return false
  if (edit.text.includes('\n')) return false
  if (span.start < edit.from && edit.from < span.end) return true
  if (!isWordLikeText(edit.text)) return false
  if (span.end === edit.from) return isWordBeforeOffset(previousText, edit.from)
  if (span.start === edit.from) {
    return (
      !isWordBeforeOffset(previousText, edit.from) && isWordCodePointAt(previousText, edit.from)
    )
  }

  return false
}

function shiftSpan(span: TokenSpan, delta: number): boolean {
  span.start += delta
  span.end += delta
  return true
}

function isWordLikeText(text: string): boolean {
  return /^[\p{L}\p{N}_]+$/u.test(text)
}

function isWordBeforeOffset(text: TokenProjectionText, offset: number): boolean {
  const previous = previousCodePointBeforeOffset(text, offset)
  if (previous === null) return false
  return isWordText(previous)
}

function isWordCodePointAt(text: TokenProjectionText, offset: number): boolean {
  const codePointText = codePointAtOffset(text, offset)
  if (codePointText === null) return false
  return isWordText(codePointText)
}

function isWordText(text: string): boolean {
  const codePoint = text.codePointAt(0)
  if (codePoint === undefined) return false
  return /^[\p{L}\p{N}_]$/u.test(String.fromCodePoint(codePoint))
}

function previousCodePointBeforeOffset(text: TokenProjectionText, offset: number): string | null {
  if (offset <= 0) return null

  const previousText = getProjectionTextInRange(text, Math.max(0, offset - 2), offset)
  if (previousText.length === 0) return null

  const previous = previousText.length - 1
  const codeUnit = previousText.charCodeAt(previous)
  const beforePrevious = previous - 1
  const isLowSurrogate = codeUnit >= 0xdc00 && codeUnit <= 0xdfff
  if (!isLowSurrogate || beforePrevious < 0) return previousText[previous] ?? null

  const previousCodeUnit = previousText.charCodeAt(beforePrevious)
  const isHighSurrogate = previousCodeUnit >= 0xd800 && previousCodeUnit <= 0xdbff
  if (!isHighSurrogate) return previousText[previous] ?? null

  return previousText.slice(beforePrevious)
}

function codePointAtOffset(text: TokenProjectionText, offset: number): string | null {
  const length = projectionTextLength(text)
  if (offset < 0 || offset >= length) return null

  const codePointText = getProjectionTextInRange(text, offset, Math.min(offset + 2, length))
  const codePoint = codePointText.codePointAt(0)
  if (codePoint === undefined) return null
  return String.fromCodePoint(codePoint)
}

function projectionTextLength(text: TokenProjectionText): number {
  return typeof text === 'string' ? text.length : text.length
}

function getProjectionTextInRange(text: TokenProjectionText, start: number, end: number): string {
  if (typeof text === 'string') return text.slice(start, end)
  return text.readRange(start, end)
}

function recordTokenProjection(
  tokens: EditorTokenStore,
  window: TokenWindow,
  resultCount: number,
  editCount: number,
): void {
  recordEditorPerformanceDiagnostic('editor.tokenProjection.path', () => ({
    affectedCount: Math.max(0, window.last - window.first),
    editCount,
    monotonicEnd: tokens.monotonicEnd,
    nonOverlapping: tokens.nonOverlapping,
    path: 'window',
    resultCount,
    tokenCount: tokens.length,
  }))
}
