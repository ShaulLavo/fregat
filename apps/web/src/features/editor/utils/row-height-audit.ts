export type RowHeightAudit = {
  readonly ok: boolean
  /** Vertical distance between the first two mounted rows: the row height the virtualizer used. */
  readonly rowPitch: number | null
  /** Painted height of the first mounted row: the row height CSS resolved. */
  readonly rowRectHeight: number
  readonly rowLineHeight: string
  readonly editorRowHeightVar: string
  readonly rootRowHeightVar: string
  readonly rootFontSizeVar: string
  readonly rootFontMonoVar: string
  readonly editorFontSize: string
  readonly editorLineHeight: string
  readonly mountedRows: number
  readonly devicePixelRatio: number
  readonly fontsStatus: string
  readonly visibility: DocumentVisibilityState
}

const SCROLL_ELEMENT_SELECTOR = '.editor-virtualized'
const ROW_SELECTOR = '.editor-virtualized-row'
const TOLERANCE_PX = 0.5

/**
 * Cross-checks the two things that must agree for rows to stack: the pitch the virtualizer
 * positioned rows at and the height CSS gave each row. Returns null when nothing is mounted yet.
 */
export function auditRowHeight(inputElement: Element): RowHeightAudit | null {
  const scrollElement = inputElement.closest<HTMLElement>(SCROLL_ELEMENT_SELECTOR)
  if (!scrollElement) return null
  const rows = scrollElement.querySelectorAll<HTMLElement>(ROW_SELECTOR)
  const first = rows[0]
  if (!first) return null

  const view = scrollElement.ownerDocument.defaultView
  if (!view) return null

  const root = scrollElement.ownerDocument.documentElement
  const rootStyle = view.getComputedStyle(root)
  const editorStyle = view.getComputedStyle(scrollElement)
  const rowStyle = view.getComputedStyle(first)
  const rowRectHeight = first.getBoundingClientRect().height
  const rowPitch = smallestPitch(rows)
  return {
    ok: rowsAgree(rowRectHeight, rowPitch, rowStyle.lineHeight),
    rowPitch,
    rowRectHeight,
    rowLineHeight: rowStyle.lineHeight,
    editorRowHeightVar: editorStyle.getPropertyValue('--editor-row-height').trim(),
    rootRowHeightVar: rootStyle.getPropertyValue('--editor-row-height').trim(),
    rootFontSizeVar: rootStyle.getPropertyValue('--editor-font-size').trim(),
    rootFontMonoVar: rootStyle.getPropertyValue('--font-mono').trim(),
    editorFontSize: editorStyle.fontSize,
    editorLineHeight: editorStyle.lineHeight,
    mountedRows: rows.length,
    devicePixelRatio: view.devicePixelRatio,
    fontsStatus: scrollElement.ownerDocument.fonts?.status ?? 'unavailable',
    visibility: scrollElement.ownerDocument.visibilityState,
  }
}

function rowsAgree(rowRectHeight: number, rowPitch: number | null, lineHeight: string): boolean {
  if (rowRectHeight < 1) return false
  if (rowPitch !== null && Math.abs(rowPitch - rowRectHeight) > TOLERANCE_PX) return false

  // Rows keep an inline height, so a collapsed line-height is what actually hides the text.
  const lineHeightPx = Number.parseFloat(lineHeight)
  if (!Number.isFinite(lineHeightPx)) return true
  return Math.abs(lineHeightPx - rowRectHeight) <= TOLERANCE_PX
}

// Recycled rows are not in row order in the DOM, so the pitch is the smallest gap between tops.
function smallestPitch(rows: NodeListOf<HTMLElement>): number | null {
  if (rows.length < 2) return null

  const tops = Array.from(rows, (row) => row.getBoundingClientRect().top).sort((a, b) => a - b)
  // Every row on one top is the stacked case; it reads as a pitch of zero, not as unknown.
  let pitch = 0
  for (let index = 1; index < tops.length; index += 1) {
    const gap = tops[index]! - tops[index - 1]!
    if (gap <= 0) continue
    if (pitch === 0 || gap < pitch) pitch = gap
  }
  return pitch
}
