import type { TextReadSnapshot } from '../documentTextSnapshot'
import { readLeadingWhitespace } from '../textWindows'
import type { InlineReplacementSpec } from '../inlineMap'
import { normalizeLineEndings, type PieceTableSnapshot } from '@singapore-editor/textbuffer'

import { nextWordOffset } from '../textRanges'
import type { TextEdit } from '../tokens'
import type { EditorCommandId } from './commands'

export type EditorInlineSuggestCommandId =
  | 'editor.action.inlineSuggest.commit'
  | 'editor.action.inlineSuggest.acceptNextWord'

const INLINE_SUGGEST_COMMANDS = new Set<EditorCommandId>([
  'editor.action.inlineSuggest.commit',
  'editor.action.inlineSuggest.acceptNextWord',
])

export function isEditorInlineSuggestCommand(
  command: EditorCommandId,
): command is EditorInlineSuggestCommandId {
  return INLINE_SUGGEST_COMMANDS.has(command)
}

/** One run of suggested text, hung off the offset it would be typed at. */
type GhostTextPart = {
  readonly offset: number
  readonly text: string
}

export type GhostText = {
  /** What accepting the whole of it applies: the suggestion, less what the document already holds. */
  readonly edit: TextEdit
  readonly parts: readonly GhostTextPart[]
}

/** A part of the suggestion that has been taken, and whatever of it is left to offer. */
export type AcceptedGhostText = {
  readonly edit: TextEdit
  readonly rest: TextEdit | null
}

/** How `original[originalStart..]` reads in the suggestion, as one aligned region. */
type GhostTextChange = {
  readonly originalStart: number
  readonly originalLength: number
  readonly modifiedStart: number
  readonly modifiedLength: number
}

/**
 * The longest pair still worth aligning. Past this the suggestion is a rewrite of the line rather
 * than a completion of it, and nothing that big can be read as ghost text anyway.
 */
const DIFF_LENGTH_LIMIT = 5000

/**
 * How far apart the two may be before the alignment is abandoned. One endpoint band per step is kept
 * so the path can be walked back, so the memory held grows with the square of this number.
 */
const DIFF_STEP_LIMIT = 400

const OPEN_PAREN = 0x28
const CLOSE_PAREN = 0x29

/** Enough room between two bracket codes for both halves of every pair at every depth. */
const BRACKET_GROUP_STRIDE = 100

/**
 * Derives the runs of an inline suggestion that can be shown in front of the reader.
 *
 * A suggestion arrives as an ordinary replacement, which may rewrite text rather than only add to it;
 * ghost text can only add. What the document already holds is stripped off the front, the remainder
 * is aligned against the text it replaces, and every region that purely inserts becomes a run at the
 * offset it would be typed at. A region that also takes characters away ends the whole thing: text
 * that is about to disappear cannot be drawn as text that is about to arrive.
 */
export function computeGhostText(
  source: TextReadSnapshot,
  suggestion: TextEdit,
  caret: number,
): GhostText | null {
  const edit = reducedSuggestion(source, suggestion)
  if (!edit) return null

  const changes = ghostTextDiff(source.readRange(edit.from, edit.to), edit.text)
  if (!changes) return null

  const parts: GhostTextPart[] = []
  for (const change of changes) {
    if (change.originalLength > 0) return null
    if (change.modifiedLength === 0) continue

    const offset = edit.from + change.originalStart + change.originalLength
    // Nothing is shown behind the caret: what is already typed is not a suggestion, and a run drawn
    // there would read as text the reader has to delete rather than as text on offer.
    if (offset < caret) return null

    const part = edit.text.slice(change.modifiedStart, change.modifiedStart + change.modifiedLength)
    // A run is injected into one row and a row it does not fit in silently drops it, which would
    // leave the reader accepting something other than what they were shown.
    if (part.includes('\n')) return null

    parts.push({ offset, text: part })
  }

  if (parts.length === 0) return null

  return { edit, parts }
}

/** The specs that paint one suggestion, each hung off the point its run belongs at. */
export function ghostTextInlineSpecs(ghost: GhostText): readonly InlineReplacementSpec[] {
  return ghost.parts.map((part, index) => ({
    id: `ghost-text:${index}`,
    startIndex: part.offset,
    endIndex: part.offset,
    text: part.text,
    insertion: true,
    kind: 'ghost-text',
    // Styled per run rather than through `kind`, which restyles the whole row: what is on offer has
    // to read as unwritten while the line it hangs off keeps reading as the reader's own text.
    className: 'editor-ghost-text',
    // The caret belongs in front of what is on offer, never inside it: the run is the document as it
    // would be, and arrowing into text nobody has typed has nowhere to go.
    cursorStops: 'left' as const,
  }))
}

/**
 * The suggestion that is showing, with the document and the caret it was derived from.
 *
 * Validity is snapshot object identity, exactly as the snippet session's is: a suggestion describes
 * one state of the text, and any edit — typed, undone, or from another view — leaves it describing a
 * document that no longer exists. The caret is the other half of that state and expires it just as
 * hard: every run was placed relative to where the caret stood, so once it has moved the offer is
 * about a position the reader has left, and taking it would write the text somewhere they are not
 * looking. Rather than trying to salvage either, the session goes quiet and whoever produced the
 * suggestion is free to offer another.
 */
export class GhostTextSession {
  private validForSnapshot: PieceTableSnapshot | null = null
  private validForCaret: number | null = null
  private ghost: GhostText | null = null
  private painted: GhostText | null = null

  /** Offers a suggestion at the caret, and reports whether any of it can be shown. */
  show(
    snapshot: PieceTableSnapshot,
    source: TextReadSnapshot,
    suggestion: TextEdit,
    caret: number,
  ): boolean {
    const ghost = computeGhostText(source, suggestion, caret)
    this.validForSnapshot = ghost ? snapshot : null
    this.validForCaret = ghost ? caret : null
    this.ghost = ghost
    return ghost !== null
  }

  /** The runs to paint, remembering them as what the map now holds. */
  specs(snapshot: PieceTableSnapshot, caret: number | null): readonly InlineReplacementSpec[] {
    const ghost = this.current(snapshot, caret)
    this.painted = ghost

    return ghost ? ghostTextInlineSpecs(ghost) : []
  }

  /**
   * Whether what should be on screen differs from what was last handed over to be painted.
   *
   * The map that carries the runs is rebuilt from its providers, not edited in place, so a suggestion
   * that has just expired or been re-offered has to say so or the previous one keeps its columns.
   */
  needsRepaint(snapshot: PieceTableSnapshot, caret: number | null): boolean {
    return this.current(snapshot, caret) !== this.painted
  }

  /** The whole suggestion, taken; null when none is showing. */
  accept(snapshot: PieceTableSnapshot, caret: number | null): AcceptedGhostText | null {
    const ghost = this.current(snapshot, caret)
    if (!ghost) return null

    this.clear()
    return { edit: ghost.edit, rest: null }
  }

  /**
   * As much of the suggestion as one word-right motion covers, with the rest left on offer.
   *
   * The remainder is described as the same replacement over a range widened by what was taken, so it
   * is re-derived from the text the accepted word produced rather than from a plan made before it —
   * including the last word, where re-deriving it leaves nothing and the session falls quiet.
   */
  acceptNextWord(
    snapshot: PieceTableSnapshot,
    caret: number | null,
    wordSeparators: string,
  ): AcceptedGhostText | null {
    const ghost = this.current(snapshot, caret)
    const part = ghost?.parts[0]
    if (!ghost || !part) return null

    const length = nextWordOffset(part.text, 0, wordSeparators)

    return {
      edit: { from: part.offset, to: part.offset, text: part.text.slice(0, length) },
      rest: { from: ghost.edit.from, to: ghost.edit.to + length, text: ghost.edit.text },
    }
  }

  clear(): void {
    this.validForSnapshot = null
    this.validForCaret = null
    this.ghost = null
  }

  private current(snapshot: PieceTableSnapshot, caret: number | null): GhostText | null {
    if (this.validForSnapshot !== snapshot || this.validForCaret !== caret) this.clear()

    return this.ghost
  }
}

/**
 * Strips what the document already holds off the front of a suggestion, and re-bases one that starts
 * inside the line's own indentation.
 *
 * Null for a suggestion whose covered rows are not text the document already reads that way.
 */
function reducedSuggestion(source: TextReadSnapshot, suggestion: TextEdit): TextEdit | null {
  const from = clampOffset(source, Math.min(suggestion.from, suggestion.to))
  const to = clampOffset(source, Math.max(suggestion.from, suggestion.to))
  const proposed = normalizeLineEndings(suggestion.text)
  const replaced = source.readRange(from, to)
  const shared = commonPrefixLength(replaced, proposed)
  const stripped = { from: from + shared, to, text: proposed.slice(shared) }

  // A replacement still covering rows after its common prefix is rewriting text the reader has
  // already written, which is a refactoring rather than a completion of what they are typing.
  if (replaced.includes('\n', shared)) return null

  return rebasedOnIndentation(source, stripped)
}

/**
 * Moves a suggestion that reaches back into the line's leading whitespace past the whitespace that is
 * already there, so indentation is never drawn a second time in front of itself.
 */
function rebasedOnIndentation(source: TextReadSnapshot, edit: TextEdit): TextEdit {
  const line = source.lineRange(source.lineAt(edit.from))
  const indentEnd = line.start + readLeadingWhitespace(source, line.start, line.end).length
  if (edit.from > indentEnd) return edit

  const replacedIndentation = source.readRange(edit.from, indentEnd)
  const from = Math.min(edit.from + replacedIndentation.length, edit.to)
  const indented = edit.text.startsWith(replacedIndentation)

  return {
    from,
    to: edit.to,
    // Indenting deeper leaves what is there and adds to it, so only the addition is new. Indenting
    // differently rewrites whitespace nobody can see change, so only what follows it can be shown.
    text: indented
      ? edit.text.slice(replacedIndentation.length)
      : edit.text.slice(indentEndOffset(edit.text, 0)),
  }
}

type CachedGhostTextDiff = {
  readonly original: string
  readonly modified: string
  readonly changes: readonly GhostTextChange[] | null
}

let lastGhostTextDiff: CachedGhostTextDiff | null = null

/**
 * The aligned regions between the replaced text and the suggestion, remembered for the last pair.
 *
 * The same suggestion is re-derived whenever it is offered again — after an accepted word, or from a
 * source that answers on every keystroke with what it already answered — and the pair asked about is
 * almost always the one just asked about.
 */
export function ghostTextDiff(
  original: string,
  modified: string,
): readonly GhostTextChange[] | null {
  const cached = lastGhostTextDiff
  if (cached && cached.original === original && cached.modified === modified) return cached.changes

  const changes = bestAlignment(original, modified)
  lastGhostTextDiff = { original, modified, changes }
  return changes
}

/**
 * Bracket alignment can force a deletion where a plain one finds none, and a single deleted character
 * costs the whole suggestion — so where it deletes anything, the plain alignment is worth computing
 * to compare against.
 */
function bestAlignment(original: string, modified: string): readonly GhostTextChange[] | null {
  const smart = alignTexts(original, modified, true)
  if (!smart) return null

  const deleted = deletedLength(smart)
  if (deleted === 0) return smart

  const plain = alignTexts(original, modified, false)
  return plain && deletedLength(plain) < deleted ? plain : smart
}

function deletedLength(changes: readonly GhostTextChange[]): number {
  let total = 0
  for (const change of changes) total += change.originalLength
  return total
}

function alignTexts(
  original: string,
  modified: string,
  brackets: boolean,
): readonly GhostTextChange[] | null {
  if (original.length > DIFF_LENGTH_LIMIT || modified.length > DIFF_LENGTH_LIMIT) return null

  const ceiling = Math.max(maxCharCode(original), maxCharCode(modified))

  return alignElements(
    diffElements(original, ceiling, brackets),
    diffElements(modified, ceiling, brackets),
  )
}

/**
 * The characters as the alignment compares them, with parentheses replaced by codes unique to their
 * depth and to the group they open.
 *
 * A bare `)` matches the first `)` a greedy alignment meets, which is how completing a call around an
 * existing expression comes out scrambled: the closer of the unfinished call lands against the closer
 * of an inner one. Making the pair carry its own structure aligns it against the bracket that means
 * the same thing rather than the one that looks the same.
 */
function diffElements(source: string, ceiling: number, brackets: boolean): Int32Array {
  const elements = new Int32Array(source.length)
  let level = 0
  let group = 0

  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index)
    if (brackets && code === OPEN_PAREN) {
      elements[index] = ceiling + 2 * (group * BRACKET_GROUP_STRIDE + level) + 1
      level += 1
      continue
    }
    if (brackets && code === CLOSE_PAREN) {
      level = Math.max(level - 1, 0)
      elements[index] = ceiling + 2 * (group * BRACKET_GROUP_STRIDE + level) + 2
      if (level === 0) group += 1
      continue
    }

    elements[index] = code
  }

  return elements
}

function maxCharCode(source: string): number {
  let max = 0
  for (let index = 0; index < source.length; index += 1) {
    max = Math.max(max, source.charCodeAt(index))
  }
  return max
}

/**
 * Aligns two element sequences and returns the regions that do not correspond, or null when they lie
 * further apart than the step limit allows.
 *
 * The alignment is the shortest path that drops original elements and takes modified ones, matching
 * equal ones for free; each step's furthest reach per diagonal is recorded so the path can be walked
 * back once the end is reached.
 */
function alignElements(
  original: Int32Array,
  modified: Int32Array,
): readonly GhostTextChange[] | null {
  const originalCount = original.length
  const modifiedCount = modified.length
  const stepLimit = Math.min(originalCount + modifiedCount, DIFF_STEP_LIMIT)
  // A diagonal is reachable only after as many steps as it is far from the origin, so the band of
  // live endpoints never widens past the step limit.
  const band = stepLimit + 1
  const endpoints = new Int32Array(2 * band + 1)
  const trace: Int32Array[] = []

  for (let step = 0; step <= stepLimit; step += 1) {
    trace.push(endpoints.slice(band - step, band + step + 1))

    for (let diagonal = -step; diagonal <= step; diagonal += 2) {
      const afterInsert = endpoints[band + diagonal + 1] ?? 0
      const afterDelete = endpoints[band + diagonal - 1] ?? 0
      const inserts = diagonal === -step || (diagonal !== step && afterDelete < afterInsert)
      let x = inserts ? afterInsert : afterDelete + 1
      let y = x - diagonal
      while (x < originalCount && y < modifiedCount && original[x] === modified[y]) {
        x += 1
        y += 1
      }
      endpoints[band + diagonal] = x

      if (x >= originalCount && y >= modifiedCount) {
        return changesFromTrace(trace, originalCount, modifiedCount)
      }
    }
  }

  return null
}

/**
 * Walks the recorded alignment back from the end, collecting every step that was not a match.
 *
 * Consecutive non-matching steps belong to one region: they are separated only once a run of equal
 * elements has been walked back over, which moves both cursors away from the region being built.
 */
function changesFromTrace(
  trace: readonly Int32Array[],
  originalCount: number,
  modifiedCount: number,
): GhostTextChange[] {
  const regions: {
    originalStart: number
    originalEnd: number
    modifiedStart: number
    modifiedEnd: number
  }[] = []
  let open: (typeof regions)[number] | null = null
  let x = originalCount
  let y = modifiedCount

  for (let step = trace.length - 1; step > 0; step -= 1) {
    const endpoints = trace[step]
    if (!endpoints) break

    const diagonal = x - y
    const afterInsert = endpoints[diagonal + 1 + step] ?? 0
    const afterDelete = endpoints[diagonal - 1 + step] ?? 0
    const inserts = diagonal === -step || (diagonal !== step && afterDelete < afterInsert)
    const previousDiagonal = inserts ? diagonal + 1 : diagonal - 1
    const previousX = inserts ? afterInsert : afterDelete
    const previousY = previousX - previousDiagonal

    while (x > previousX && y > previousY) {
      x -= 1
      y -= 1
    }

    if (open && open.originalStart === x && open.modifiedStart === y) {
      open.originalStart = previousX
      open.modifiedStart = previousY
    } else {
      open = {
        originalStart: previousX,
        originalEnd: x,
        modifiedStart: previousY,
        modifiedEnd: y,
      }
      regions.push(open)
    }

    x = previousX
    y = previousY
  }

  return regions.reverse().map((region) => ({
    originalStart: region.originalStart,
    originalLength: region.originalEnd - region.originalStart,
    modifiedStart: region.modifiedStart,
    modifiedLength: region.modifiedEnd - region.modifiedStart,
  }))
}

function indentEndOffset(text: string, from: number): number {
  let end = from
  while (end < text.length) {
    const code = text.charCodeAt(end)
    if (code !== 0x20 && code !== 0x09) break
    end += 1
  }

  return end
}

/** Stops short of splitting a surrogate pair: half a code point is not a place to start drawing. */
function commonPrefixLength(left: string, right: string): number {
  const shared = Math.min(left.length, right.length)
  let length = 0
  while (length < shared && left.charCodeAt(length) === right.charCodeAt(length)) length += 1
  if (length > 0 && isHighSurrogate(left.charCodeAt(length - 1))) length -= 1

  return length
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function clampOffset(source: TextReadSnapshot, offset: number): number {
  return Math.max(0, Math.min(offset, source.length))
}
