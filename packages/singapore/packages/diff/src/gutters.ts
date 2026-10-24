import type { DiffRenderRow } from './types'

export type DiffGutterSide = 'old' | 'new' | 'stacked'
export type DiffGutterNumberSide = Exclude<DiffGutterSide, 'stacked'>
export type DiffGutterLaneKind = DiffGutterNumberSide | 'indicator'

/**
 * What a lane is coloured *as*, rather than what colour it ends up. The DOM gutter resolves the
 * colour in CSS so a theme can override it; keeping the branching here means the rule that an
 * addition tints the new lane and not the old one lives in exactly one place.
 */
export type DiffGutterLaneTone = 'added' | 'deleted' | 'hunk' | 'default'

type DiffGutterLaneLayout = {
  readonly kind: DiffGutterLaneKind
  readonly left: number
  readonly width: number
}

export type DiffGutterLayout = {
  readonly lanes: readonly DiffGutterLaneLayout[]
  readonly width: number
}

/* Both match the plain line gutter (`DEFAULT_LINE_GUTTER_MIN_COLUMNS`, `LINE_GUTTER_PADDING_PX`),
   so a diff number sits at the same inset from the pane edge as an editor number. */
const MIN_LINE_NUMBER_DIGITS = 3
const GUTTER_NUMBER_RESERVED_WIDTH = 8
const GUTTER_INDICATOR_WIDTH = 12

/**
 * The widest line number each lane has to fit, in digits.
 *
 * Computed once when a projection is built rather than inside `width()`. The gutter's width is
 * invalidated far more often than the rows change, and the scan is over *every* projected row —
 * which in overlay mode means every line of the file, since `createLiveDiffProjection` materializes
 * a row per unchanged line. A 50,000-line file was re-scanning 50,000 rows and allocating a string
 * per row, twice in stacked mode, on every gutter-width recompute.
 */
export type DiffGutterDigits = {
  readonly old: number
  readonly new: number
}

export function diffGutterDigits(rows: readonly DiffRenderRow[]): DiffGutterDigits {
  let oldDigits = 0
  let newDigits = 0
  for (const row of rows) {
    if (row.type === 'hunk' || row.type === 'empty') continue
    oldDigits = Math.max(oldDigits, digitCount(row.oldLineNumber))
    newDigits = Math.max(newDigits, digitCount(row.newLineNumber))
  }

  return { old: oldDigits, new: newDigits }
}

export function diffGutterWidth(
  side: DiffGutterSide,
  digits: DiffGutterDigits,
  lineCount: number,
  characterWidth: number,
): number {
  return diffGutterLayout(side, digits, lineCount, characterWidth).width
}

export function diffGutterLayout(
  side: DiffGutterSide,
  digits: DiffGutterDigits,
  lineCount: number,
  characterWidth: number,
): DiffGutterLayout {
  if (side !== 'stacked') {
    const numberWidth = gutterNumberLaneWidth(side, digits, lineCount, characterWidth)
    const width = numberWidth + GUTTER_INDICATOR_WIDTH
    return {
      lanes: [
        { kind: side, left: 0, width: numberWidth },
        { kind: 'indicator', left: numberWidth, width: GUTTER_INDICATOR_WIDTH },
      ],
      width,
    }
  }

  const oldWidth = gutterNumberLaneWidth('old', digits, lineCount, characterWidth)
  const newWidth = gutterNumberLaneWidth('new', digits, lineCount, characterWidth)
  const indicatorLeft = oldWidth + newWidth
  return {
    lanes: [
      { kind: 'old', left: 0, width: oldWidth },
      { kind: 'new', left: oldWidth, width: newWidth },
      { kind: 'indicator', left: indicatorLeft, width: GUTTER_INDICATOR_WIDTH },
    ],
    width: indicatorLeft + GUTTER_INDICATOR_WIDTH,
  }
}

function diffGutterWidthCharacters(
  side: DiffGutterSide,
  digits: DiffGutterDigits,
  lineCount: number,
): number {
  if (side === 'stacked') {
    return (
      diffGutterWidthCharacters('old', digits, lineCount) +
      diffGutterWidthCharacters('new', digits, lineCount)
    )
  }

  const maxCharacters = Math.max(String(Math.max(1, lineCount)).length, digits[side])
  return Math.max(MIN_LINE_NUMBER_DIGITS, maxCharacters)
}

function digitCount(value: number | undefined): number {
  if (value === undefined) return 0
  return String(value).length
}

export function diffGutterNumberText(row: DiffRenderRow, side: DiffGutterNumberSide): string {
  return lineNumberForRow(row, side)
}

export function diffGutterIndicatorText(row: DiffRenderRow): string {
  if (row.type === 'addition') return '+'
  if (row.type === 'deletion') return '-'
  if (row.type === 'hunk' && row.expandable) return row.expanded ? '−' : '+'
  return ''
}

/**
 * Side-awareness in this gutter is **per lane, not per pane** (plan §3.3). In stacked mode one
 * gutter carries both number lanes, and for a single addition row the old lane stays foreground
 * while the new lane goes green — so a row-level class cannot express it and each lane carries its
 * own tone.
 *
 * The indicator lane is deliberately side-agnostic: it shows `+`/`-` for the row as a whole.
 */
export function diffGutterLaneTone(
  row: DiffRenderRow,
  kind: DiffGutterLaneKind,
): DiffGutterLaneTone {
  if (row.type === 'hunk') return 'hunk'
  if (kind === 'indicator') {
    if (row.type === 'addition') return 'added'
    if (row.type === 'deletion') return 'deleted'
    return 'default'
  }

  if (row.type === 'addition' && kind !== 'old') return 'added'
  if (row.type === 'deletion' && kind !== 'new') return 'deleted'
  return 'default'
}

/**
 * Whether the gutter band behind a row is tinted. Unlike the lane tone this *is* per pane: a split
 * old pane shows no tint behind an addition, because that row is a placeholder there.
 */
export function diffGutterRowTone(row: DiffRenderRow, side: DiffGutterSide): DiffGutterLaneTone {
  if (row.type === 'addition' && side !== 'old') return 'added'
  if (row.type === 'deletion' && side !== 'new') return 'deleted'
  if (row.type === 'hunk') return 'hunk'
  return 'default'
}

function gutterNumberLaneWidth(
  side: DiffGutterNumberSide,
  digits: DiffGutterDigits,
  lineCount: number,
  characterWidth: number,
): number {
  const characters = diffGutterWidthCharacters(side, digits, lineCount)
  return Math.ceil(characters * characterWidth + GUTTER_NUMBER_RESERVED_WIDTH)
}

function lineNumberForRow(row: DiffRenderRow, side: DiffGutterNumberSide): string {
  if (row.type === 'hunk' || row.type === 'empty') return ''
  if (side === 'old') return formatLineNumber(row.oldLineNumber)
  return formatLineNumber(row.newLineNumber)
}

function formatLineNumber(value: number | undefined): string {
  if (value === undefined) return ''
  return String(value)
}
