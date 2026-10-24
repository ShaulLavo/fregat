import type { TextEdit } from '@singapore-editor/core'

/**
 * The longest replacement still worth re-diffing.
 *
 * Past this the comparison costs more than it saves: a reply that rewrites this much has left
 * almost no anchor, decoration or fold inside the span to preserve, and the diff itself becomes the
 * expensive part of formatting.
 */
export const REDIFF_LENGTH_LIMIT = 100_000

/**
 * How far apart the two texts may be before the alignment is abandoned.
 *
 * One endpoint band per step is kept so the alignment can be walked back, so the memory held grows
 * with the square of this number. A reply differing by more than this is a rewrite rather than a
 * reformat, and is cheaper to apply whole.
 */
const REDIFF_STEP_LIMIT = 400

type LineRegion = {
  originalStart: number
  originalEnd: number
  replacementStart: number
  replacementEnd: number
}

/**
 * Splits a replacement into edits covering only what differs from the text it overwrites.
 *
 * A formatter answers with the whole document, or a whole line, even when three characters moved.
 * Applying that verbatim rewrites text that did not change, and every anchor, decoration, fold and
 * selection inside the rewritten span dies with it — so the reply is compared against the buffer
 * first and only the differences are handed on.
 *
 * `offset` is where `original` starts in the document, so the returned edits address the buffer.
 */
export function minimalReplacementEdits(
  original: string,
  replacement: string,
  offset: number,
): TextEdit[] {
  if (original === replacement) return []
  if (Math.max(original.length, replacement.length) > REDIFF_LENGTH_LIMIT) {
    return [wholeReplacement(original, replacement, offset)]
  }

  const originalLines = splitAfterLineBreaks(original)
  const replacementLines = splitAfterLineBreaks(replacement)
  const regions = changedLineRegions(originalLines, replacementLines)
  if (!regions) return [wholeReplacement(original, replacement, offset)]

  const originalStarts = lineStartOffsets(originalLines)
  const replacementStarts = lineStartOffsets(replacementLines)

  const edits: TextEdit[] = []
  for (const region of regions) {
    const edit = narrowToDifference(
      original,
      originalStarts[region.originalStart] ?? 0,
      originalStarts[region.originalEnd] ?? original.length,
      replacement.slice(
        replacementStarts[region.replacementStart] ?? 0,
        replacementStarts[region.replacementEnd] ?? replacement.length,
      ),
      offset,
    )
    if (edit.from !== edit.to || edit.text.length > 0) edits.push(edit)
  }
  return edits
}

function wholeReplacement(original: string, replacement: string, offset: number): TextEdit {
  return { from: offset, text: replacement, to: offset + original.length }
}

/**
 * Shrinks one region to the characters inside it that differ.
 *
 * Line alignment hands back the whole line an indentation change sits in; dropping what the two
 * sides still share turns that into the handful of characters the formatter actually touched. A
 * boundary steps back off a surrogate pair, because half a code point is not something the rest of
 * the editor can anchor to.
 */
function narrowToDifference(
  original: string,
  from: number,
  to: number,
  text: string,
  offset: number,
): TextEdit {
  const shared = Math.min(to - from, text.length)

  let prefix = 0
  while (prefix < shared && original.charCodeAt(from + prefix) === text.charCodeAt(prefix)) {
    prefix += 1
  }
  if (prefix > 0 && isHighSurrogate(text.charCodeAt(prefix - 1))) prefix -= 1

  let suffix = 0
  while (
    suffix < shared - prefix &&
    original.charCodeAt(to - 1 - suffix) === text.charCodeAt(text.length - 1 - suffix)
  ) {
    suffix += 1
  }
  if (suffix > 0 && isLowSurrogate(text.charCodeAt(text.length - suffix))) suffix -= 1

  return {
    from: offset + from + prefix,
    text: text.slice(prefix, text.length - suffix),
    to: offset + to - suffix,
  }
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

/** Lines keep their terminator, so concatenating them back gives the text they came from. */
function splitAfterLineBreaks(text: string): string[] {
  const lines: string[] = []
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 10) continue

    lines.push(text.slice(start, index + 1))
    start = index + 1
  }
  lines.push(text.slice(start))
  return lines
}

function lineStartOffsets(lines: readonly string[]): number[] {
  const starts = [0]
  let offset = 0
  for (const line of lines) {
    offset += line.length
    starts.push(offset)
  }
  return starts
}

/**
 * Aligns two line sequences and returns the runs that do not correspond, or null when they lie
 * further apart than the step limit allows.
 *
 * The alignment is the shortest path that deletes original lines and inserts replacement ones,
 * taking equal lines for free; each step's furthest reach per diagonal is recorded so the path can
 * be walked back once the end is reached.
 *
 * Lines rather than characters, because a formatter's changes are line-shaped and aligning by line
 * costs a fraction of what aligning by character would; `narrowToDifference` recovers the
 * character-level precision afterwards, as a linear scan of one region.
 */
function changedLineRegions(
  original: readonly string[],
  replacement: readonly string[],
): LineRegion[] | null {
  const originalCount = original.length
  const replacementCount = replacement.length
  const stepLimit = Math.min(originalCount + replacementCount, REDIFF_STEP_LIMIT)
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
      while (x < originalCount && y < replacementCount && original[x] === replacement[y]) {
        x += 1
        y += 1
      }
      endpoints[band + diagonal] = x

      if (x >= originalCount && y >= replacementCount) {
        return regionsFromTrace(trace, originalCount, replacementCount)
      }
    }
  }

  return null
}

/**
 * Walks the recorded alignment back from the end, collecting every step that was not a match.
 *
 * Consecutive non-matching steps belong to one region: they are separated only once a run of equal
 * lines has been walked back over, which moves both cursors away from the region being built.
 */
function regionsFromTrace(
  trace: readonly Int32Array[],
  originalCount: number,
  replacementCount: number,
): LineRegion[] {
  const regions: LineRegion[] = []
  let open: LineRegion | null = null
  let x = originalCount
  let y = replacementCount

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

    if (open && open.originalStart === x && open.replacementStart === y) {
      open.originalStart = previousX
      open.replacementStart = previousY
    } else {
      open = {
        originalEnd: x,
        originalStart: previousX,
        replacementEnd: y,
        replacementStart: previousY,
      }
      regions.push(open)
    }

    x = previousX
    y = previousY
  }

  return regions.reverse()
}
