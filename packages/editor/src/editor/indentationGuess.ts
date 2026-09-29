import type { TextLineRange, TextReadSnapshot } from '../documentTextSnapshot'
import { TextBlockReader } from '../textWindows'

/**
 * The indentation width a document is already written in, read off its own text.
 *
 * The width is not only what a new line copies: outdent takes back one of them, guides are drawn one
 * per level, and the fold heuristic measures nesting in them. So a file indented two spaces that is
 * edited in units of four is wrong on every one of those at once, in a way the user sees immediately.
 * Deriving it from the content means the answer comes from the file rather than from whatever the
 * host happened to configure for some other file.
 *
 * Only the width is derived here. Whether a line gets tabs or spaces stays a per-line decision made
 * where the line is written, which is the better answer in a document that mixes the two.
 */

// Bounded so a 10M-line file costs the same as a 10k-line one. A document does not change its
// indentation width halfway down, so a prefix answers as well as the whole.
const SAMPLED_LINE_LIMIT = 10_000

// Even widths are tried first, so a document that scores two candidates equally settles on the one
// more likely to have been meant. Nothing outside this range is worth guessing at.
const CANDIDATE_TAB_SIZES = [2, 4, 6, 8, 3, 5, 7] as const
const LARGEST_CANDIDATE_TAB_SIZE = 8

const SPACE = 0x20
const TAB = 0x09
const COMMA = 0x2c

/** One sampled line, held as offsets into the text so nothing is copied out of it. */
type SampledLine = {
  readonly start: number
  /** Exclusive: the line break, or the end of the text. */
  readonly end: number
  /** First non-whitespace offset, or `end` for a line that has no content. */
  readonly indentEnd: number
  readonly spaces: number
  readonly tabs: number
}

type IndentationDiff = {
  /** Spaces one line is indented past the other, or 0 when the pair says nothing about a width. */
  readonly spacesDiff: number
  readonly looksLikeAlignment: boolean
}

const NO_INDENTATION_DIFF: IndentationDiff = { spacesDiff: 0, looksLikeAlignment: false }

/**
 * The indentation width `source` is written in, or `fallbackTabSize` when its content does not say.
 *
 * Every pair of consecutive lines that have content votes for the width of the step between them;
 * the width with the most votes wins. Text indented with tabs abstains entirely — a tab is one level
 * whatever its display width, so there is nothing in it to measure and the configured width remains
 * the only authority on how wide to draw one.
 *
 * Reads the sampled lines through bounded blocks, so a long line is never copied whole.
 */
export function guessedTabSize(source: TextReadSnapshot, fallbackTabSize: number): number {
  const text = new TextBlockReader(source)
  const scores = Array.from<number>({ length: LARGEST_CANDIDATE_TAB_SIZE + 1 }).fill(0)
  let linesIndentedWithTabs = 0
  let linesIndentedWithSpaces = 0
  let previous: SampledLine | null = null
  const sampledLines = Math.min(SAMPLED_LINE_LIMIT, source.lineCount)

  for (let row = 0; row < sampledLines; row += 1) {
    const line = sampleLine(text, source.lineRange(row))
    // A blank line is not a level, and it must not become the baseline the next line is measured
    // against either — the step is between lines that have content.
    if (line.indentEnd === line.end) continue

    if (line.tabs > 0) linesIndentedWithTabs += 1
    else if (line.spaces > 1) linesIndentedWithSpaces += 1

    // The first line with content has no line above it that it stepped in from, so its indentation is
    // an absolute column rather than a step. Counting it would let a fragment that merely begins
    // indented name a width off one line.
    const diff = previous === null ? NO_INDENTATION_DIFF : indentationDiff(text, previous, line)
    // Alignment that happens to be exactly the width already in effect is indistinguishable from
    // real nesting — a continued bullet list reads precisely like this — so let that one case vote
    // rather than discard the single document shape where the two agree.
    if (diff.looksLikeAlignment && diff.spacesDiff !== fallbackTabSize) continue

    previous = line
    if (diff.spacesDiff <= LARGEST_CANDIDATE_TAB_SIZE) {
      scores[diff.spacesDiff] = (scores[diff.spacesDiff] ?? 0) + 1
    }
  }

  if (linesIndentedWithTabs > linesIndentedWithSpaces) return fallbackTabSize

  let bestScore = 0
  let bestTabSize = fallbackTabSize
  for (const candidate of CANDIDATE_TAB_SIZES) {
    const score = scores[candidate] ?? 0
    if (score > bestScore) {
      bestScore = score
      bestTabSize = candidate
    }
  }
  return bestTabSize
}

function sampleLine(text: TextBlockReader, range: TextLineRange): SampledLine {
  const { start, end } = range
  let spaces = 0
  let tabs = 0
  let index = start

  for (; index < end; index += 1) {
    const code = text.charCodeAt(index)
    if (code === SPACE) spaces += 1
    else if (code === TAB) tabs += 1
    else break
  }
  return { start, end, indentEnd: index, spaces, tabs }
}

/**
 * The step between two lines' indentation, in spaces.
 *
 * Only what the two lines do *not* share counts, so a deeper line indented with a tab and then four
 * spaces contributes those four rather than a mixture nothing can divide. When both the tabs and the
 * spaces changed, the spaces are per tab: that is a file whose one level is a tab plus a part-level
 * of spaces, and the part is the width being looked for.
 */
function indentationDiff(
  text: TextBlockReader,
  previous: SampledLine,
  line: SampledLine,
): IndentationDiff {
  const shared = sharedIndentationLength(text, previous, line)
  const previousTail = indentationCounts(text, previous.start + shared, previous.indentEnd)
  const lineTail = indentationCounts(text, line.start + shared, line.indentEnd)

  // Indentation that mixes both units past the shared part cannot be attributed to either.
  if (previousTail.spaces > 0 && previousTail.tabs > 0) return NO_INDENTATION_DIFF
  if (lineTail.spaces > 0 && lineTail.tabs > 0) return NO_INDENTATION_DIFF

  const tabsDiff = Math.abs(previousTail.tabs - lineTail.tabs)
  const spacesDiff = Math.abs(previousTail.spaces - lineTail.spaces)

  if (tabsDiff === 0) {
    return {
      spacesDiff,
      looksLikeAlignment: looksLikeAlignment(text, previous, line, spacesDiff, lineTail.spaces),
    }
  }
  if (spacesDiff % tabsDiff === 0) {
    return { spacesDiff: spacesDiff / tabsDiff, looksLikeAlignment: false }
  }
  return NO_INDENTATION_DIFF
}

function sharedIndentationLength(
  text: TextBlockReader,
  previous: SampledLine,
  line: SampledLine,
): number {
  const previousLength = previous.indentEnd - previous.start
  const lineLength = line.indentEnd - line.start
  let shared = 0

  while (
    shared < previousLength &&
    shared < lineLength &&
    text.charCodeAt(previous.start + shared) === text.charCodeAt(line.start + shared)
  ) {
    shared += 1
  }
  return shared
}

function indentationCounts(
  text: TextBlockReader,
  start: number,
  end: number,
): { readonly spaces: number; readonly tabs: number } {
  let spaces = 0
  let tabs = 0

  for (let index = start; index < end; index += 1) {
    if (text.charCodeAt(index) === SPACE) spaces += 1
    else tabs += 1
  }
  return { spaces, tabs }
}

/**
 * Whether the extra spaces put this line's first token under a token on the line above, rather than
 * nesting it beneath the line above.
 *
 * A continued declaration list is written `const a = 1,` / `      b = 2`: those six spaces exist to
 * line `b` up with `a`, and six is just where that column fell. Counting it would teach the document
 * its own left margin as an indentation width, and a file with a few aligned declarations would
 * outvote its real one. The line above ending in a comma is what tells the two apart — a line that
 * opens a nested block does not end mid-list.
 */
function looksLikeAlignment(
  text: TextBlockReader,
  previous: SampledLine,
  line: SampledLine,
  spacesDiff: number,
  lineSpaces: number,
): boolean {
  if (spacesDiff === 0 || lineSpaces < 1) return false

  const previousLength = previous.end - previous.start
  const lineLength = line.end - line.start
  if (lineSpaces - 1 >= previousLength || lineSpaces >= lineLength) return false

  // The alignment column has to be where this line's token starts and where the line above has a gap
  // between tokens; anything else is two lines that merely differ in depth.
  if (text.charCodeAt(line.start + lineSpaces) === SPACE) return false
  if (text.charCodeAt(previous.start + lineSpaces - 1) !== SPACE) return false

  return text.charCodeAt(previous.end - 1) === COMMA
}
