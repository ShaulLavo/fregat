import {
  anchorAfter,
  anchorBefore,
  type PieceTableAnchor as Anchor,
  type PieceTableSnapshot,
  resolveAnchor,
} from '@singapore-editor/textbuffer'

import type { TextEdit } from '../tokens'

/**
 * Ranges holding one name in two places, which have to go on holding the same one: a markup
 * element's opening and closing tag names.
 *
 * The pair is worked out by scanning the text rather than by asking the parse tree, because a tree
 * reaches us a frame or more after the keystroke that changed it and a rename cannot wait for it. A
 * scan pays for that with ambiguity — a `<` in an expression looks like a tag opener — so nothing
 * links unless the name has a matching closing tag, and a name whose partner sits further away than
 * the window below simply does not link.
 */

export type LinkedEditingRange = {
  readonly start: number
  readonly end: number
}

/** Reads document text. Never asked for an empty range, so a reader need not answer for one. */
type RangeReader = (from: number, to: number) => string

export type LinkedEditingChange = {
  readonly edits: readonly TextEdit[]
  readonly caretOffset: number
}

export type LinkedEditingChangeOptions = {
  readonly read: RangeReader
  /** Every range that has to hold the same name, in document order. */
  readonly ranges: readonly LinkedEditingRange[]
  /** The one being typed in; the others are made to copy it. */
  readonly reference: LinkedEditingRange
  readonly start: number
  readonly end: number
  readonly text: string
  readonly wordPattern: RegExp
}

/** How far from the caret a partner tag may sit and still be found. */
const SCAN_RADIUS = 10_000

/** Enough text around the caret to see the whole of any name and the delimiter that opens it. */
const NAME_RADIUS = 128

const NAME_START = /[A-Za-z_$]/

/** What a name may be made of while scanning for one; whether it is still a word is asked later. */
const NAME_PART = /[\w.:$-]/

type ScannedTag = {
  readonly closing: boolean
  readonly name: string
  readonly nameStart: number
  readonly nameEnd: number
}

type TrackedRange = {
  readonly startAnchor: Anchor
  readonly endAnchor: Anchor
}

/**
 * The names that must stay identical to the one at `offset`, read through `read`.
 *
 * Two reads, of deliberately different sizes: whether the caret is in a name at all is asked of a
 * handful of characters, and only an offset that passes pays for the region read that can say where
 * the partner is. Typing anywhere else in the document is the common case and must stay cheap.
 */
export function linkedEditingRangesAround(
  read: RangeReader,
  length: number,
  offset: number,
): readonly LinkedEditingRange[] | null {
  const nameStart = Math.max(0, offset - NAME_RADIUS)
  const nameText = read(nameStart, Math.min(length, offset + NAME_RADIUS))
  if (!tagNameRangeAt(nameText, offset - nameStart)) return null

  const windowStart = Math.max(0, offset - SCAN_RADIUS)
  const windowText = read(windowStart, Math.min(length, offset + SCAN_RADIUS))
  const ranges = tagPairRangesAt(windowText, offset - windowStart)
  if (!ranges) return null

  return ranges.map((range) => ({ end: range.end + windowStart, start: range.start + windowStart }))
}

/** The range an edit falls inside, which is the one whose text the others are made to copy. */
export function referenceRangeFor(
  ranges: readonly LinkedEditingRange[],
  start: number,
  end: number,
): LinkedEditingRange | null {
  return ranges.find((range) => range.start <= start && end <= range.end) ?? null
}

/**
 * One batch that types `text` over `[start, end)` and carries the same name into every other range,
 * or null when the result would stop being a single word — which is how a rename ends.
 *
 * Batched rather than applied in turn because the mirrored text is not a change the user made: it
 * has to be undone by the same keystroke that caused it, not by a second undo they never asked for.
 */
export function linkedEditingChange(
  options: LinkedEditingChangeOptions,
): LinkedEditingChange | null {
  const { end, ranges, read, reference, start, text, wordPattern } = options
  const referenceText = rangeText(read, reference)
  const nextText =
    referenceText.slice(0, start - reference.start) +
    text +
    referenceText.slice(end - reference.start)
  if (!isOneWord(wordPattern, nextText)) return null

  const edits: TextEdit[] = [{ from: start, text, to: end }]
  let caretOffset = start + text.length
  for (const range of ranges) {
    if (range.start === reference.start && range.end === reference.end) continue

    const edit = minimalMirrorEdit(rangeText(read, range), nextText, range.start)
    if (!edit) continue

    edits.push(edit)
    // A mirror ahead of the caret leaves it where it was; one behind moves the whole document under
    // it, and the caret is handed back in the coordinates the batch produces.
    if (edit.to <= start) caretOffset += edit.text.length - (edit.to - edit.from)
  }

  return { caretOffset, edits }
}

/**
 * The ranges of a rename in progress, held as anchors.
 *
 * Held rather than looked for again on every keystroke: finding the partner means reading a region
 * of the document and walking every tag in it, which is affordable once per rename and not once per
 * character. The anchors bias outward, so a character typed against either end of a name joins the
 * name instead of escaping it, and each keystroke finds the ranges already carrying what the one
 * before it shifted.
 */
export class LinkedEditingSession {
  private validForSnapshot: PieceTableSnapshot | null = null
  private tracked: readonly TrackedRange[] = []

  start(snapshot: PieceTableSnapshot, ranges: readonly LinkedEditingRange[]): void {
    this.validForSnapshot = snapshot
    this.tracked = ranges.map((range) => ({
      endAnchor: anchorAfter(snapshot, range.end),
      startAnchor: anchorBefore(snapshot, range.start),
    }))
  }

  /** Where the tracked names are now, or null once the session no longer describes the document. */
  ranges(snapshot: PieceTableSnapshot): readonly LinkedEditingRange[] | null {
    if (this.validForSnapshot !== snapshot) return null

    const ranges: LinkedEditingRange[] = []
    for (const tracked of this.tracked) {
      const start = resolveAnchor(snapshot, tracked.startAnchor)
      const end = resolveAnchor(snapshot, tracked.endAnchor)
      if (start.liveness !== 'live' || end.liveness !== 'live') return null
      if (end.offset < start.offset) return null

      ranges.push({ end: end.offset, start: start.offset })
    }

    return ranges
  }

  /** Keeps the session alive across an edit this editor itself produced. */
  advance(snapshot: PieceTableSnapshot): void {
    if (this.validForSnapshot === null) return

    this.validForSnapshot = snapshot
  }

  clear(): void {
    this.validForSnapshot = null
    this.tracked = []
  }
}

/**
 * The edit that turns `currentText` into `targetText`, covering only the characters that differ.
 *
 * Replacing the whole range instead would delete and re-insert text that never changed, taking
 * every decoration, anchor and cursor sitting in the untouched part of the mirrored name with it.
 */
function minimalMirrorEdit(
  currentText: string,
  targetText: string,
  start: number,
): TextEdit | null {
  if (currentText === targetText) return null

  const shortest = Math.min(currentText.length, targetText.length)
  let prefix = 0
  while (prefix < shortest && currentText.charAt(prefix) === targetText.charAt(prefix)) prefix += 1

  let suffix = 0
  while (
    suffix < shortest - prefix &&
    currentText.charAt(currentText.length - 1 - suffix) ===
      targetText.charAt(targetText.length - 1 - suffix)
  ) {
    suffix += 1
  }

  return {
    from: start + prefix,
    text: targetText.slice(prefix, targetText.length - suffix),
    to: start + currentText.length - suffix,
  }
}

function rangeText(read: RangeReader, range: LinkedEditingRange): string {
  return range.end <= range.start ? '' : read(range.start, range.end)
}

/**
 * Whether `text` is one word by the language's own reckoning.
 *
 * The whole of it has to match, not a prefix of it: a name pattern happily matches the `div` in
 * `div>`, and the typed `>` is precisely the keystroke that has to end the rename.
 */
function isOneWord(pattern: RegExp, text: string): boolean {
  if (text.length === 0) return false

  pattern.lastIndex = 0
  const match = pattern.exec(text)

  return match !== null && match.index === 0 && match[0].length === text.length
}

/**
 * The two name ranges of the element whose opening or closing tag name covers `offset`.
 *
 * Either name answers, so a rename started from the closing tag drives the opening one.
 */
function tagPairRangesAt(text: string, offset: number): readonly LinkedEditingRange[] | null {
  const name = tagNameRangeAt(text, offset)
  if (!name) return null

  const open: ScannedTag[] = []
  for (const tag of scanTags(text)) {
    if (!tag.closing) {
      open.push(tag)
      continue
    }

    for (let index = open.length - 1; index >= 0; index -= 1) {
      const opener = open[index]
      if (!opener || opener.name !== tag.name) continue
      if (coversName(opener, name) || coversName(tag, name)) {
        return [
          { end: opener.nameEnd, start: opener.nameStart },
          { end: tag.nameEnd, start: tag.nameStart },
        ]
      }

      // Whatever is left above the match was never closed — a void element, or markup still being
      // written — and must not go on swallowing the closing tags of its ancestors.
      open.length = index
      break
    }
  }

  return null
}

function coversName(tag: ScannedTag, name: LinkedEditingRange): boolean {
  return tag.nameStart === name.start && tag.nameEnd === name.end
}

/**
 * The whole tag name `offset` sits in, including at either of its boundaries.
 *
 * The boundaries count as inside because that is where a rename is typed: appending to a name and
 * inserting in front of it are both edits to the name, not edits next to it.
 */
function tagNameRangeAt(text: string, offset: number): LinkedEditingRange | null {
  let start = offset
  while (start > 0 && NAME_PART.test(text.charAt(start - 1))) start -= 1
  if (start === 0) return null
  if (!NAME_START.test(text.charAt(start))) return null

  const opener = text.charAt(start - 1) === '/' ? start - 2 : start - 1
  if (opener < 0 || text.charAt(opener) !== '<') return null

  let end = offset
  while (end < text.length && NAME_PART.test(text.charAt(end))) end += 1

  return { end, start }
}

/**
 * The tags in `text`, in document order, self-closing ones omitted.
 *
 * A tag that closes itself is left out rather than recorded: it has no partner to keep in step, and
 * counting it as an opener would hand it its ancestor's closing tag.
 */
function scanTags(text: string): readonly ScannedTag[] {
  const tags: ScannedTag[] = []
  let index = 0

  while (index < text.length) {
    const opener = text.indexOf('<', index)
    if (opener === -1) break

    index = opener + 1
    if (text.startsWith('!--', index)) {
      const commentEnd = text.indexOf('-->', index)
      index = commentEnd === -1 ? text.length : commentEnd + 3
      continue
    }

    const closing = text.charAt(index) === '/'
    const nameStart = closing ? index + 1 : index
    const nameEnd = tagNameEnd(text, nameStart)
    if (nameEnd === nameStart) continue

    const body = tagBodyEnd(text, nameEnd)
    index = body.end
    if (body.selfClosing) continue

    tags.push({ closing, name: text.slice(nameStart, nameEnd), nameEnd, nameStart })
  }

  return tags
}

function tagNameEnd(text: string, start: number): number {
  if (!NAME_START.test(text.charAt(start))) return start

  let end = start + 1
  while (end < text.length && NAME_PART.test(text.charAt(end))) end += 1
  return end
}

/**
 * Where a tag ends, and whether it closed itself there.
 *
 * Quoted attribute values and braced expressions are stepped over whole, because either can carry a
 * `>` that does not end the tag — a comparison in a prop, a generic argument, an arrow in a title —
 * and a tag ended early leaves the text after it being read as markup.
 */
function tagBodyEnd(
  text: string,
  from: number,
): { readonly end: number; readonly selfClosing: boolean } {
  let braces = 0
  let index = from
  let lastSignificant = ''

  while (index < text.length) {
    const char = text.charAt(index)
    if (char === '"' || char === "'") {
      index = quotedEnd(text, index)
      lastSignificant = char
      continue
    }
    if (char === '{') braces += 1
    else if (char === '}') braces = Math.max(0, braces - 1)
    else if (braces === 0 && char === '>') {
      return { end: index + 1, selfClosing: lastSignificant === '/' }
    }

    if (!/\s/.test(char)) lastSignificant = char
    index += 1
  }

  return { end: text.length, selfClosing: false }
}

function quotedEnd(text: string, start: number): number {
  const closer = text.indexOf(text.charAt(start), start + 1)
  return closer === -1 ? text.length : closer + 1
}
