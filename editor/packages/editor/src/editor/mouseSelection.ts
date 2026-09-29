import type { TextOffsetRange } from '../textRanges'
import type { SelectionAffinity } from '../selections'
import { clamp } from '../style-utils'
import type { TextEdit } from '../tokens'
import type {
  VirtualizedBidiSelectionAnchor,
  VirtualizedTextHitPosition,
} from '../virtualization/virtualizedTextViewTypes'

/**
 * What each end of a drag snaps to. `column` is the odd one out: it follows the pointer the same
 * way, but the selection it leaves behind is a rectangle rather than a range.
 */
export type MouseSelectionGranularity = 'char' | 'word' | 'line' | 'column'

export type MouseSelectionAnchor = {
  readonly range: TextOffsetRange
  readonly bidi: VirtualizedBidiSelectionAnchor | null
}

export type MouseSelectionDrag = {
  // The drag pivots on whichever end of the anchored word or line the pointer is away from, so the
  // unit the press landed on stays whole however far the pointer travels in either direction.
  readonly anchor: MouseSelectionAnchor
  readonly granularity: MouseSelectionGranularity
  head: VirtualizedTextHitPosition
  clientX: number
  clientY: number
}

export type MouseSelectionEnds = {
  readonly anchorOffset: number
  readonly headOffset: number
}

/**
 * A head stopping exactly where the anchor begins has still crossed it — the pointer is on the far
 * side of the anchored word or line — so the ends merely touching is a backwards drag, not an empty
 * one.
 */
export function mouseSelectionEnds(
  anchor: TextOffsetRange,
  head: TextOffsetRange,
): MouseSelectionEnds {
  if (head.end <= anchor.start) return { anchorOffset: anchor.end, headOffset: head.start }
  return { anchorOffset: anchor.start, headOffset: head.end }
}

/**
 * A press that landed inside the selection, which may yet carry that text elsewhere. Nothing is
 * committed while it is held, because the same press is still the click that places the caret if it
 * turns out never to travel.
 */
export type MouseTextMoveDrag = {
  readonly source: TextOffsetRange
  readonly sourceAffinity: SelectionAffinity
  readonly sourceReversed: boolean
  readonly press: VirtualizedTextHitPosition
  // Null whenever the pointer is back over the run being carried, where there is nowhere to put it:
  // a release there has to leave the document alone rather than fall back on some earlier spot the
  // user has since moved away from.
  drop: VirtualizedTextHitPosition | null
  moved: boolean
}

export type MouseTextMove = {
  readonly edits: readonly TextEdit[]
  readonly selection: TextOffsetRange
}

/**
 * Where dropped text ends up.
 *
 * A move is one delete and one insert measured against the same document, so text travelling right
 * arrives at an offset its own removal then pulls back — by exactly its own length. Landing on
 * either edge of the source leaves the document as it was, which is worth an edit only when the
 * original is being left behind.
 */
export function mouseTextMove(
  source: TextOffsetRange,
  text: string,
  dropOffset: number,
  copy: boolean,
): MouseTextMove | null {
  if (dropOffset > source.start && dropOffset < source.end) return null
  if (copy) {
    return {
      edits: [{ from: dropOffset, text, to: dropOffset }],
      selection: { start: dropOffset, end: dropOffset + text.length },
    }
  }

  if (dropOffset === source.start || dropOffset === source.end) return null

  const start = dropOffset < source.start ? dropOffset : dropOffset - text.length
  return {
    edits: [
      { from: source.start, text: '', to: source.end },
      { from: dropOffset, text, to: dropOffset },
    ],
    selection: { start, end: start + text.length },
  }
}

const MOUSE_SELECTION_SCROLL_ZONE_PX = 40
const MOUSE_SELECTION_MAX_SCROLL_PX = 24
const MOUSE_SELECTION_MIN_SCROLL_PX = 2

/** How far the viewport should travel this frame on each axis, signed towards the pointer. */
export type MouseSelectionAutoScrollDelta = {
  readonly x: number
  readonly y: number
}

export const NO_MOUSE_SELECTION_AUTO_SCROLL: MouseSelectionAutoScrollDelta = { x: 0, y: 0 }

type HorizontalInsets = {
  readonly left: number
  readonly right: number
}

const NO_HORIZONTAL_INSETS: HorizontalInsets = { left: 0, right: 0 }

/**
 * `insets` are the edges that show no text — the sticky gutter, an overlay's reserved padding. The
 * zones start there, or a pointer over the gutter would sit on text it cannot see and never scroll.
 */
export function mouseSelectionAutoScrollDelta(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  insets: HorizontalInsets = NO_HORIZONTAL_INSETS,
): MouseSelectionAutoScrollDelta {
  return {
    x: autoScrollAxisDelta(
      clientX,
      rect.left + insets.left,
      rect.right - insets.right,
      rect.width - insets.left - insets.right,
    ),
    y: autoScrollAxisDelta(clientY, rect.top, rect.bottom, rect.height),
  }
}

/** A viewport under two zones wide would sit in both at once and only ever scroll one way. */
function autoScrollAxisDelta(point: number, start: number, end: number, size: number): number {
  if (size <= 0) return 0

  const zone = Math.min(MOUSE_SELECTION_SCROLL_ZONE_PX, size / 2)
  if (point < start + zone) return -mouseSelectionScrollStep(start + zone - point)
  if (point > end - zone) return mouseSelectionScrollStep(point - (end - zone))

  return 0
}

function mouseSelectionScrollStep(distance: number): number {
  const ratio = distance / MOUSE_SELECTION_SCROLL_ZONE_PX
  const scaled = Math.ceil(ratio * MOUSE_SELECTION_MAX_SCROLL_PX)
  return clamp(scaled, MOUSE_SELECTION_MIN_SCROLL_PX, MOUSE_SELECTION_MAX_SCROLL_PX)
}
