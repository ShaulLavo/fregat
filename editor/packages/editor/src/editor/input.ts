import {
  offsetToPoint,
  type PieceTableSnapshot,
  pointToOffset,
  readPieceTableTextRange,
} from '@singapore-editor/textbuffer'
import { isHighSurrogate, splitsSurrogatePair } from '@singapore-editor/textbuffer/internal/reads'

import { clamp } from '../style-utils'

/** What the hidden input held, and where its selection sat, when the editor last looked. */
export type HiddenInputState = {
  readonly value: string
  readonly selectionStart: number
  readonly selectionEnd: number
}

/** A window of the document written into the hidden input, ready to be handed to the element. */
export type HiddenInputContent = HiddenInputState & {
  readonly direction: 'forward' | 'backward'
}

/**
 * What a change to the hidden input meant, said around the editor's own selection: replace this
 * many characters before it and this many after it with `text`.
 */
export type DeducedInputEdit = {
  readonly text: string
  readonly replacePrevCharCnt: number
  readonly replaceNextCharCnt: number
}

export const EMPTY_HIDDEN_INPUT_STATE: HiddenInputState = {
  selectionEnd: 0,
  selectionStart: 0,
  value: '',
}

/**
 * How much of the document the hidden input carries around the caret, in rows.
 *
 * A page either side is what lets a screen reader's read-next-line and read-previous-line land on
 * real text without the editor rewriting the element between every keystroke.
 */
export const SCREEN_READER_PAGE_ROWS = 10

/**
 * The ceiling on the text either side of the selection, in characters.
 *
 * This is the load-bearing half of the pairing: a browser recomputes the accessible value of the
 * element on every write, and that computation is superlinear enough that a few thousand characters
 * stall the whole frame. A page is a bound on rows, not on their length — one minified line would
 * blow straight past it — so the character clamp is what actually keeps a huge file's arrow keys
 * responding in constant time.
 */
export const SCREEN_READER_TRIM_CHARS = 500

/** Stands in for the text a clamp cut away, so what is read still says something was skipped. */
const ELLIPSIS = '…'

/**
 * Text that arrives with no input event to carry it, deduced from the key that was pressed.
 *
 * Only a surface that is not the hidden input needs this: anything typed into the hidden input
 * reaches the document as a `beforeinput`, or as a change to the input's own value that
 * `deduceHiddenInputEdit` reads back. A key pressed on the scroll element produces neither, so
 * there is nothing to read and the key itself is all the editor has.
 */
export function keyboardFallbackText(event: KeyboardEvent): string | null {
  if (event.defaultPrevented) return null
  if (event.isComposing) return null
  if (event.metaKey || event.ctrlKey || event.altKey) return null
  if (event.key === 'Enter') return '\n'
  if (event.key.length !== 1) return null

  return event.key
}

export function readHiddenInputState(input: HTMLTextAreaElement): HiddenInputState {
  return {
    selectionEnd: input.selectionEnd,
    selectionStart: input.selectionStart,
    value: input.value,
  }
}

/**
 * What the browser did to the hidden input, worked out by diffing it against what the editor put
 * there.
 *
 * This is the whole reason the input carries text at all. An autocorrection, a dead key, a
 * dictated phrase and an Android keyboard's word-level suggestion all arrive as input events the
 * editor cannot read a payload out of — but each one leaves the answer behind in the element, as
 * the difference between two known strings. One diff covers all of them, so none of them needs a
 * branch of its own and none of them has to be guessed from a key code.
 *
 * The common prefix and suffix are clamped by both selections rather than taken whole, which is
 * what stops a repeated character next to the caret from being counted as text that never moved:
 * typing 'l' into 'hel|lo' shares four leading characters with 'hell|lo', but only three of them
 * are in front of where the caret was.
 */
export function deduceHiddenInputEdit(
  previous: HiddenInputState,
  current: HiddenInputState,
): DeducedInputEdit {
  // A caret that moved without the text moving says where the next edit will go, not that one
  // happened. Deducing from the selections alone would hand back a replacement of whatever the
  // caret stepped over, which is how a bare cursor move turns into a retyped character.
  if (previous.value === current.value) {
    return { replaceNextCharCnt: 0, replacePrevCharCnt: 0, text: '' }
  }

  const prefixLength = Math.min(
    commonPrefixLength(previous.value, current.value),
    previous.selectionStart,
    current.selectionStart,
  )
  const suffixLength = Math.min(
    commonSuffixLength(previous.value, current.value),
    previous.value.length - previous.selectionEnd,
    current.value.length - current.selectionEnd,
  )
  const replaced = previous.value.slice(prefixLength, previous.value.length - suffixLength)

  return {
    // Counted from the far side of what was replaced rather than reported as zero, because a
    // keyboard that rewrites a whole word around the caret — 'Mic|osoft' becoming 'Microsoft' —
    // consumes text the caret was standing in front of. Typing the replacement without taking that
    // text away is the double-insertion those keyboards are known for.
    replaceNextCharCnt: replaced.length - (previous.selectionEnd - prefixLength),
    replacePrevCharCnt: previous.selectionStart - prefixLength,
    text: current.value.slice(prefixLength, current.value.length - suffixLength),
  }
}

/**
 * Half of an astral character, or the delete control code, which is not yet an edit.
 *
 * A keyboard emitting an emoji one code unit at a time hands over the leading half first. Left in
 * the input and diffed against again on the next event, the pair deduces as the single character it
 * is; typed on arrival it would be a lone surrogate the document can never repair.
 */
export function isIncompleteDeducedInput(edit: DeducedInputEdit): boolean {
  if (edit.replacePrevCharCnt !== 0 || edit.replaceNextCharCnt !== 0) return false
  if (edit.text.length !== 1) return false

  const code = edit.text.charCodeAt(0)
  return isHighSurrogate(code) || code === 0x7f
}

/**
 * Nothing for the document to do — which is not the same as an empty triple.
 *
 * The counts are measured outwards from the selection, so they have no way to name the selection
 * itself: a browser that took a selected word away leaves all three fields empty. Deciding this on
 * the counts alone would swallow exactly those deletions.
 */
export function isEmptyDeducedInput(edit: DeducedInputEdit, previous: HiddenInputState): boolean {
  if (edit.text.length !== 0) return false
  if (edit.replacePrevCharCnt !== 0 || edit.replaceNextCharCnt !== 0) return false

  return previous.selectionStart === previous.selectionEnd
}

/**
 * An EditContext update, which names the range it replaced in the window last written, said around
 * the caret the way a deduced edit is. A range that stops short of the caret (a word corrected behind
 * it) rewrites the text between the two as itself, so every caret keeps what stood before it.
 */
export function textUpdateEdit(
  written: HiddenInputState,
  update: { readonly text: string; readonly rangeStart: number; readonly rangeEnd: number },
): DeducedInputEdit {
  const from = Math.min(update.rangeStart, written.selectionStart)
  const to = Math.max(update.rangeEnd, written.selectionEnd)
  return {
    text:
      written.value.slice(from, update.rangeStart) +
      update.text +
      written.value.slice(update.rangeEnd, to),
    replacePrevCharCnt: written.selectionStart - from,
    replaceNextCharCnt: to - written.selectionEnd,
  }
}

/**
 * The slice of the document the hidden input carries: the page before the selection, the page it
 * starts on, the selection, the page it ends on, and the page after.
 *
 * Paging is what keeps this affordable on a large file — the alternative, handing over the whole
 * document, is what makes a naive implementation hang on open. The neighbouring pages are what make
 * the window an interval around the caret rather than one that can end at it: standing on the first
 * character of a page, the element would hold nothing in front of the caret, and a backward delete
 * the browser performs on the element itself finds nothing to take and raises no event at all — so
 * the keystroke would be lost rather than merely unread.
 *
 * A selection spanning more than the two pages it touches is spliced with an ellipsis rather than
 * materialized whole: what is read then says a stretch was skipped, which is true, instead of taking
 * a second to say nothing.
 */
export function pagedHiddenInputContent(
  snapshot: PieceTableSnapshot,
  selection: {
    readonly startOffset: number
    readonly endOffset: number
    readonly reversed: boolean
  },
  options: { readonly rowsPerPage?: number; readonly trimChars?: number } = {},
): HiddenInputContent {
  const rowsPerPage = Math.max(1, options.rowsPerPage ?? SCREEN_READER_PAGE_ROWS)
  const trimChars = Math.max(0, options.trimChars ?? SCREEN_READER_TRIM_CHARS)
  const start = clamp(selection.startOffset, 0, snapshot.length)
  const end = clamp(selection.endOffset, start, snapshot.length)

  const startPage = Math.floor(offsetToPoint(snapshot, start).row / rowsPerPage)
  const endPage = Math.floor(offsetToPoint(snapshot, end).row / rowsPerPage)
  const pretextStart = trimmedWindowStart(
    snapshot,
    pageStartOffset(snapshot, startPage - 1, rowsPerPage),
    start,
    trimChars,
  )
  const posttextEnd = trimmedWindowEnd(
    snapshot,
    end,
    pageStartOffset(snapshot, endPage + 2, rowsPerPage),
    trimChars,
  )

  const pretext = readPieceTableTextRange(snapshot, pretextStart, start)
  const posttext = readPieceTableTextRange(snapshot, end, posttextEnd)
  const selected = trimmedSelectionText(
    snapshot,
    { start, end, startPage, endPage },
    rowsPerPage,
    trimChars,
  )

  return {
    direction: selection.reversed ? 'backward' : 'forward',
    selectionEnd: pretext.length + selected.length,
    selectionStart: pretext.length,
    value: `${pretext}${selected}${posttext}`,
  }
}

function pageStartOffset(snapshot: PieceTableSnapshot, page: number, rowsPerPage: number): number {
  return pointToOffset(snapshot, { column: 0, row: page * rowsPerPage })
}

function trimmedWindowStart(
  snapshot: PieceTableSnapshot,
  pageStart: number,
  selectionStart: number,
  trimChars: number,
): number {
  if (trimChars === 0) return pageStart
  if (selectionStart - pageStart <= trimChars) return pageStart

  const trimmed = selectionStart - trimChars
  return splitsSurrogatePair(snapshot, trimmed) ? trimmed + 1 : trimmed
}

function trimmedWindowEnd(
  snapshot: PieceTableSnapshot,
  selectionEnd: number,
  pageEnd: number,
  trimChars: number,
): number {
  if (trimChars === 0) return pageEnd
  if (pageEnd - selectionEnd <= trimChars) return pageEnd

  const trimmed = selectionEnd + trimChars
  return splitsSurrogatePair(snapshot, trimmed) ? trimmed - 1 : trimmed
}

function trimmedSelectionText(
  snapshot: PieceTableSnapshot,
  selection: {
    readonly start: number
    readonly end: number
    readonly startPage: number
    readonly endPage: number
  },
  rowsPerPage: number,
  trimChars: number,
): string {
  const { start, end, startPage, endPage } = selection
  const spliced =
    endPage - startPage > 1
      ? spliceAcrossPages(snapshot, selection, rowsPerPage)
      : readPieceTableTextRange(snapshot, start, end)
  if (trimChars === 0 || spliced.length <= 2 * trimChars) return spliced

  return `${sliceWholeCharacters(spliced, 0, trimChars)}${ELLIPSIS}${sliceWholeCharacters(spliced, spliced.length - trimChars, spliced.length)}`
}

function spliceAcrossPages(
  snapshot: PieceTableSnapshot,
  selection: {
    readonly start: number
    readonly end: number
    readonly startPage: number
    readonly endPage: number
  },
  rowsPerPage: number,
): string {
  const { start, end, startPage, endPage } = selection
  const head = clamp(pageStartOffset(snapshot, startPage + 1, rowsPerPage), start, end)
  const tail = clamp(pageStartOffset(snapshot, endPage, rowsPerPage), head, end)

  return `${readPieceTableTextRange(snapshot, start, head)}${ELLIPSIS}${readPieceTableTextRange(snapshot, tail, end)}`
}

/** A slice that never keeps half a pair, so a clamp cannot invent an unpaired surrogate. */
function sliceWholeCharacters(text: string, start: number, end: number): string {
  const from = start > 0 && isLowSurrogateAt(text, start) ? start + 1 : start
  const to = end < text.length && isLowSurrogateAt(text, end) ? end - 1 : end
  return text.slice(from, Math.max(from, to))
}

function isLowSurrogateAt(text: string, index: number): boolean {
  const code = text.charCodeAt(index)
  return code >= 0xdc00 && code <= 0xdfff
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length)
  let length = 0
  while (length < limit && left.charCodeAt(length) === right.charCodeAt(length)) length += 1
  return length
}

function commonSuffixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length)
  let length = 0
  while (
    length < limit &&
    left.charCodeAt(left.length - length - 1) === right.charCodeAt(right.length - length - 1)
  ) {
    length += 1
  }
  return length
}
