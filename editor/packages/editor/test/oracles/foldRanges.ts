import type { EditorSyntaxLanguageId, FoldRange } from '../../src/syntax/session'
type EditorFoldingRules = { offSide: boolean; regionStart: RegExp; regionEnd: RegExp }
const matches = (pattern: RegExp, text: string): boolean => pattern.test(text)

type FoldLine = {
  /** Offset the line's text ends at, which is where a region starting or ending here is pinned. */
  readonly end: number
  /** Visible column the line's content starts at, or `BLANK_INDENT` when it has none. */
  readonly indent: number
  readonly marker: 'start' | 'end' | null
}

/**
 * A block still being extended as the walk moves up the document. `endAbove` is the row the block
 * above this one must stop before; `line` is where an explicit region began.
 */
type OpenRegion = {
  indent: number
  endAbove: number
  line: number
}

const BLANK_INDENT = -1
/** Sorts below every real indentation so an explicit region is never popped by one. */
const MARKER_INDENT = -2

/**
 * What a document nobody has described gets: off-side, because a document we cannot name is
 * indistinguishable from prose, where a blank line reads as a separator; and any of the usual comment
 * openers, which costs nothing — a line has to say `region` after one to match — and is the difference
 * between markers working and not working in an unnamed file.
 */
const FALLBACK_FOLDING_RULES: EditorFoldingRules = {
  offSide: true,
  regionEnd: /^\s*(?:\/\/|\/\*|#|--|;|%|<!--)\s*#?endregion\b/,
  regionStart: /^\s*(?:\/\/|\/\*|#|--|;|%|<!--)\s*#?region\b/,
}

/**
 * Regions to fold by when nothing that reads a grammar has an answer — the document has no grammar,
 * or its first parse has not landed yet.
 */
export function fallbackFoldRanges(context: EditorFoldRangeContext): readonly FoldRange[] {
  // The fan-in downstream refuses a set that crosses itself.
  return rejectCrossingFoldRanges(indentationFoldRanges(context)).folds
}

/** What the indentation walk needs to describe a document it has no grammar for. */
export type EditorFoldRangeContext = {
  readonly text: string
  readonly languageId: string | null
  readonly tabSize: number
}

/**
 * Every line whose followers are indented past it heads a region, which runs to the last of them.
 *
 * The document is walked bottom-up against a stack of blocks still looking for their header, because
 * that is the order in which a block's end is already known by the time its header appears: the row
 * above the shallowest thing seen since. Explicit region markers ride the same stack under an
 * indentation no real line can have, so a marked region outranks indentation instead of competing
 * with it.
 */
function indentationFoldRanges(context: EditorFoldRangeContext): readonly FoldRange[] {
  const rules = foldingRulesForLanguage(context.languageId)
  // One scan of the buffer for the word every marker has to contain keeps documents that hold none —
  // nearly all of them — off the per-line matching path, which this runs on every keystroke.
  const markers = context.text.includes('region') ? rules : null
  const lines = foldLines(context.text, context.tabSize, markers)
  const folds: FoldRange[] = []
  const open: OpenRegion[] = [{ indent: BLANK_INDENT, endAbove: lines.length, line: lines.length }]

  for (let row = lines.length - 1; row >= 0; row -= 1) {
    const line = lines[row]!
    let below = open.at(-1)!

    if (line.indent === BLANK_INDENT) {
      if (rules.offSide) below.endAbove = row
      continue
    }

    if (line.marker === 'end') {
      open.push({ indent: MARKER_INDENT, endAbove: row, line: row })
      continue
    }

    if (line.marker === 'start') {
      const markerIndex = innermostMarkerIndex(open)
      if (markerIndex > 0) {
        // Blocks opened between the two markers never got a header and are dropped with the stack.
        open.length = markerIndex + 1
        below = open[markerIndex]!
        folds.push(foldRange(lines, row, below.line, 'region', context.languageId))
        below.indent = line.indent
        below.endAbove = row
        below.line = row
        continue
      }
      // No closing marker below, so the line has nothing to mark and folds by its indentation.
    }

    if (below.indent > line.indent) {
      do {
        open.pop()
        below = open.at(-1)!
      } while (below.indent > line.indent)

      const endRow = below.endAbove - 1
      if (endRow > row) folds.push(foldRange(lines, row, endRow, 'indent', context.languageId))
    }

    if (below.indent === line.indent) {
      below.endAbove = row
      continue
    }

    open.push({ indent: line.indent, endAbove: row, line: row })
  }

  return folds
}

function foldingRulesForLanguage(languageId: EditorSyntaxLanguageId | null): EditorFoldingRules {
  const language = languageId?.trim().toLowerCase()
  if (['python', 'yaml', 'yml'].includes(language ?? ''))
    return { offSide: true, regionStart: /^\s*#\s*region\b/, regionEnd: /^\s*#\s*endregion\b/ }
  if (['css'].includes(language ?? ''))
    return {
      offSide: false,
      regionStart: /^\s*\/\*\s*#?region\b/,
      regionEnd: /^\s*\/\*\s*#?endregion\b/,
    }
  if (['html', 'markdown', 'md'].includes(language ?? ''))
    return {
      offSide: ['markdown', 'md'].includes(language ?? ''),
      regionStart: /^\s*<!--\s*#?region\b/,
      regionEnd: /^\s*<!--\s*#?endregion\b/,
    }
  if (
    [
      'javascript',
      'typescript',
      'ts',
      'jsx',
      'tsx',
      'javascriptreact',
      'typescriptreact',
      'json',
      'jsonc',
      'scss',
    ].includes(language ?? '')
  )
    return {
      offSide: false,
      regionStart: /^\s*\/\/\s*#?region\b/,
      regionEnd: /^\s*\/\/\s*#?endregion\b/,
    }
  return FALLBACK_FOLDING_RULES
}

function innermostMarkerIndex(open: readonly OpenRegion[]): number {
  let index = open.length - 1
  while (index > 0 && open[index]!.indent !== MARKER_INDENT) index -= 1

  return index
}

/**
 * Both ends sit at the end of a row's text rather than at its start, so the header row stays visible
 * when the region collapses and the last row of the body is the last one hidden.
 */
function foldRange(
  lines: readonly FoldLine[],
  startRow: number,
  endRow: number,
  type: 'indent' | 'region',
  languageId: EditorSyntaxLanguageId | null,
): FoldRange {
  return {
    startIndex: lines[startRow]!.end,
    endIndex: lines[endRow]!.end,
    startLine: startRow,
    endLine: endRow,
    type,
    ...(languageId ? { languageId } : {}),
  }
}

function foldLines(
  text: string,
  tabSize: number,
  markers: EditorFoldingRules | null,
): readonly FoldLine[] {
  const lines: FoldLine[] = []
  let start = 0

  for (let index = 0; index <= text.length; index += 1) {
    if (index < text.length && text[index] !== '\n') continue

    const indent = visibleIndent(text, start, index, tabSize)
    lines.push({
      end: index,
      indent,
      marker:
        markers && indent !== BLANK_INDENT ? lineMarker(text.slice(start, index), markers) : null,
    })
    start = index + 1
  }

  return lines
}

function lineMarker(lineText: string, markers: EditorFoldingRules): FoldLine['marker'] {
  if (matches(markers.regionStart, lineText)) return 'start'
  if (matches(markers.regionEnd, lineText)) return 'end'

  return null
}

/**
 * Measured in columns rather than characters so a tab-indented line and a space-indented one nest the
 * way they look on screen.
 */
function visibleIndent(text: string, start: number, end: number, tabSize: number): number {
  let column = 0

  for (let index = start; index < end; index += 1) {
    const character = text[index]
    if (character === ' ') {
      column += 1
      continue
    }
    if (character !== '\t') return column

    column += tabSize - (column % tabSize)
  }

  return BLANK_INDENT
}

type FoldRangeRejection = {
  readonly kind: 'invalid-range' | 'overlap'
  readonly fold: FoldRange
  readonly message: string
  readonly previous?: FoldRange
}

type FoldRangeIngestionResult = {
  readonly folds: readonly FoldRange[]
  readonly rejected: readonly FoldRangeRejection[]
}

function rejectCrossingFoldRanges(folds: readonly FoldRange[]): FoldRangeIngestionResult {
  const accepted: FoldRange[] = []
  const rejected: FoldRangeRejection[] = []
  const openAncestors: FoldRange[] = []

  for (const fold of sortedFoldRangesForIngestion(folds)) {
    const invalidMessage = invalidFoldRangeMessage(fold)
    if (invalidMessage) {
      rejected.push({ kind: 'invalid-range', fold, message: invalidMessage })
      continue
    }

    const parent = innermostOpenAncestor(openAncestors, fold)
    if (parent && fold.endIndex > parent.endIndex) {
      rejected.push({
        kind: 'overlap',
        fold,
        previous: parent,
        message: 'Fold ranges must not cross',
      })
      continue
    }

    accepted.push(fold)
    openAncestors.push(fold)
  }

  return { folds: accepted, rejected }
}

function sortedFoldRangesForIngestion(folds: readonly FoldRange[]): readonly FoldRange[] {
  return [...folds].toSorted(compareFoldRangesForIngestion)
}

function compareFoldRangesForIngestion(left: FoldRange, right: FoldRange): number {
  return (
    left.startIndex - right.startIndex ||
    right.endIndex - left.endIndex ||
    left.startLine - right.startLine ||
    right.endLine - left.endLine ||
    left.type.localeCompare(right.type) ||
    foldLanguageId(left).localeCompare(foldLanguageId(right))
  )
}

function foldLanguageId(fold: FoldRange): string {
  return fold.languageId ?? ''
}

function invalidFoldRangeMessage(fold: FoldRange): string | null {
  const integerMessage =
    invalidNonNegativeIntegerMessage(fold.startIndex, 'Fold range startIndex') ??
    invalidNonNegativeIntegerMessage(fold.endIndex, 'Fold range endIndex') ??
    invalidNonNegativeIntegerMessage(fold.startLine, 'Fold range startLine') ??
    invalidNonNegativeIntegerMessage(fold.endLine, 'Fold range endLine')
  if (integerMessage) return integerMessage
  if (fold.endIndex <= fold.startIndex) {
    return 'Fold range endIndex must be greater than startIndex'
  }
  if (fold.endLine <= fold.startLine) return 'Fold range endLine must be greater than startLine'
  return null
}

function invalidNonNegativeIntegerMessage(value: number, name: string): string | null {
  if (!Number.isInteger(value)) return `${name} must be an integer`
  if (value < 0) return `${name} must be non-negative`
  return null
}

function innermostOpenAncestor(openAncestors: FoldRange[], fold: FoldRange): FoldRange | null {
  while (openAncestors.length > 0) {
    const ancestor = openAncestors.at(-1)!
    if (ancestor.endIndex > fold.startIndex) return ancestor
    openAncestors.pop()
  }

  return null
}
