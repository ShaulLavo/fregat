import type { TextReadSnapshot } from '@singapore-editor/core/document'

/** Half-open `[start, end)` offset range into the editor text buffer. */
export type OffsetRange = {
  readonly start: number
  readonly end: number
}

export function sameOffsetRange(left: OffsetRange | null, right: OffsetRange): boolean {
  return left?.start === right.start && left.end === right.end
}

/** The smallest range covering every range given, or null for none. */
export function unionOffsetRange(ranges: readonly OffsetRange[]): OffsetRange | null {
  let union: OffsetRange | null = null
  for (const range of ranges) {
    if (!union) {
      union = range
      continue
    }
    union = { start: Math.min(union.start, range.start), end: Math.max(union.end, range.end) }
  }
  return union
}

/**
 * The identifier under `offset`, or null when the offset does not sit on an identifier character.
 * An identifier character is `[A-Za-z0-9_$]`, the set TypeScript's language service treats as part
 * of a name; an offset one past the last character still counts, so a caret right after a name
 * asks about that name.
 */
export function identifierRangeAtOffset(text: string, offset: number): OffsetRange | null {
  const clamped = Math.max(0, Math.min(offset, text.length))
  const index = identifierIndexAtOffset(text, clamped)
  if (index === null) return null

  let start = index
  while (start > 0 && isIdentifierCharacter(text[start - 1] ?? '')) start -= 1

  let end = index + 1
  while (end < text.length && isIdentifierCharacter(text[end] ?? '')) end += 1

  if (end <= start) return null
  return { start, end }
}

/** The identifier at `offset`, else the single visible character there. */
export function hoverTargetRange(text: string, offset: number): OffsetRange {
  const identifier = identifierRangeAtOffset(text, offset)
  if (identifier) return identifier

  const start = Math.max(0, Math.min(offset, Math.max(0, text.length - 1)))
  return { start, end: Math.min(text.length, start + 1) }
}

const HOVER_WINDOW_RADIUS = 256

/**
 * `hoverTargetRange` over a document source, reading a window of the offset's line rather than the
 * document. The window widens only while an identifier runs into its edge.
 */
export function hoverTargetRangeInSource(source: TextReadSnapshot, offset: number): OffsetRange {
  const line = source.lineRange(source.lineAt(Math.min(offset, Math.max(0, source.length - 1))))
  // One past the break, so a caret on the line break targets it as the string search did.
  const lineEnd = Math.min(source.length, line.end + 1)
  for (let radius = HOVER_WINDOW_RADIUS; ; radius *= 2) {
    const from = Math.max(line.start, offset - radius)
    const to = Math.min(lineEnd, Math.max(from, offset + radius))
    const local = hoverTargetRange(source.readRange(from, to), offset - from)
    const range = { start: from + local.start, end: from + local.end }
    const clippedLeft = range.start === from && from > line.start
    const clippedRight = range.end === to && to < lineEnd
    if (!clippedLeft && !clippedRight) return range
  }
}

function identifierIndexAtOffset(text: string, offset: number): number | null {
  if (isIdentifierCharacter(text[offset] ?? '')) return offset
  if (offset > 0 && isIdentifierCharacter(text[offset - 1] ?? '')) return offset - 1
  return null
}

function isIdentifierCharacter(character: string): boolean {
  return /^[A-Za-z0-9_$]$/.test(character)
}
