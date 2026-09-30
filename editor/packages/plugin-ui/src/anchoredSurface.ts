import type {
  EditorDisposable,
  EditorViewContributionUpdateKind,
} from '@singapore-editor/core/extensions'

/**
 * The placement every floating surface a plugin puts up shares.
 *
 * Anchor positioning does the page arithmetic: a hidden anchor element carries `anchor-name`, the
 * surface carries `position-anchor`, and `position-area` drops it on the side we name — nothing
 * here measures the viewport to write a left and a top. What anchor positioning will not decide is
 * which side to ask for when the preferred one has no room, and how tall the surface may grow once
 * a side is chosen. That decision reads the same for a hover, a completion list, a signature and a
 * rename input, and it used to be written out once per surface.
 */

/** One hook for a host to style every floating editor surface, whatever plugin owns it. */
const EDITOR_POPUP_ATTRIBUTE = 'data-editor-popup'

/** Whether an event target sits inside any floating editor surface. */
export function isInsideEditorPopup(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return target.closest(`[${EDITOR_POPUP_ATTRIBUTE}]`) !== null
}

/** Which side of the anchor the surface takes. */
export type AnchoredSurfacePlacement = 'top' | 'bottom'

/**
 * How the surface lines up across the anchor: centred over it, or starting at its leading edge and
 * running away from it, the way a list read left to right wants to.
 */
export type AnchoredSurfaceAlignment = 'center' | 'start'

const DEFAULT_GAP_PX = 8
const DEFAULT_VIEWPORT_MARGIN_PX = 12

/**
 * Shortest ceiling worth writing. A surface anchored hard against the edge of the viewport would
 * otherwise be clamped down to nothing; overflowing the margin by a little is the better failure.
 */
const MIN_SURFACE_HEIGHT_PX = 80

let nextAnchorId = 0

export type AnchoredSurfaceOptions = {
  /** The floating element. Its owner styles and mounts it; only where it lands is ours. */
  readonly element: HTMLElement
  /** Class for the anchor element, and the stem of the anchor name the surface follows. */
  readonly anchorClassName: string
  readonly preferredPlacement: AnchoredSurfacePlacement
  readonly alignment?: AnchoredSurfaceAlignment
  /** Clear space kept between the anchor and the surface. */
  readonly gapPx?: number
  /** Clear space kept between the surface and the edge of the viewport. */
  readonly viewportMarginPx?: number
  /**
   * Tallest the surface may grow on either side. A surface with nothing to scroll leaves it out: a
   * ceiling on a single-line input is a number no reader could ever act on.
   */
  readonly maxHeightPx?: number | (() => number)
  /** The ceiling the surface landed with, for a surface whose scrolling body needs it too. */
  onPlaced?(maxHeightPx: number, placement: AnchoredSurfacePlacement): void
}

export type AnchoredSurface = EditorDisposable & {
  /**
   * Puts the surface beside `anchor`, on the side it fits and with the height that side has room
   * for. Render the content first — the side is chosen from how tall the surface actually is.
   */
  place(anchor: DOMRect, preferredPlacement?: AnchoredSurfacePlacement): void
  /** Takes the anchor out of the page while the surface is off screen. */
  release(): void
}

/**
 * Whether an update moved the text under a surface without changing what the surface says.
 *
 * A surface is placed against a rect in viewport coordinates, so a scroll or a relayout leaves it
 * pointing at text that has moved out from under it. Which kinds those are is one question with one
 * answer, asked from four controllers.
 */
export function anchoredSurfaceFollowsUpdate(kind: EditorViewContributionUpdateKind): boolean {
  return kind === 'viewport' || kind === 'layout'
}

export function createAnchoredSurface(options: AnchoredSurfaceOptions): AnchoredSurface {
  const { element } = options
  const document = element.ownerDocument
  const gapPx = options.gapPx ?? DEFAULT_GAP_PX
  const viewportMarginPx = options.viewportMarginPx ?? DEFAULT_VIEWPORT_MARGIN_PX
  const alignment = options.alignment ?? 'center'

  nextAnchorId += 1
  const anchorName = `--${options.anchorClassName}-${nextAnchorId}`
  const anchor = createAnchorElement(document, options.anchorClassName, anchorName)
  // Anchor positioning only accepts an anchor that precedes the positioned element in tree order.
  // Every owner mounts its surface before asking for one, so appending here would put the anchor
  // after it and leave the surface with no anchor at all — silently placed at its static position,
  // in the bottom corner of the page, with the right content and the wrong coordinates.
  if (element.parentNode) element.before(anchor)
  else document.body.prepend(anchor)

  // One hook for a host to style every floating editor surface, whatever plugin owns it.
  element.setAttribute(EDITOR_POPUP_ATTRIBUTE, '')
  element.style.position = 'fixed'
  element.style.setProperty('position-anchor', anchorName)
  // The surface is placed entirely by its anchor, so any inset left over from an earlier life of
  // the element would fight the position area rather than add to it.
  element.style.setProperty('inset', 'auto')
  // A surface that starts at the anchor runs off the far edge of a narrow window; the side is ours
  // and stays ours, so only the axis we did not decide is handed back to the browser.
  if (alignment === 'start') element.style.setProperty('position-try-fallbacks', 'flip-inline')
  applyPlacement(element, options.preferredPlacement, alignment, gapPx)

  let disposed = false

  const place = (
    rect: DOMRect,
    preferredPlacement: AnchoredSurfacePlacement = options.preferredPlacement,
  ): void => {
    positionAnchorElement(anchor, rect)
    const viewportHeight = document.defaultView?.innerHeight ?? 0
    const configuredMaxHeight = resolveMaxHeight(options.maxHeightPx)
    const height = surfaceHeight(element, configuredMaxHeight)
    const placement = fittingPlacement(
      rect,
      height,
      viewportHeight,
      preferredPlacement,
      gapPx,
      viewportMarginPx,
    )
    applyPlacement(element, placement, alignment, gapPx)
    if (configuredMaxHeight === undefined) return

    const room = roomBeside(rect, placement, viewportHeight, gapPx, viewportMarginPx)
    const maxHeightPx = surfaceCeiling(room, configuredMaxHeight)
    element.style.maxHeight = `${maxHeightPx}px`
    options.onPlaced?.(maxHeightPx, placement)
  }

  return {
    place,
    release: () => {
      anchor.style.display = 'none'
    },
    dispose: () => {
      if (disposed) return

      disposed = true
      anchor.remove()
    },
  }
}

function resolveMaxHeight(maxHeightPx: number | (() => number) | undefined): number | undefined {
  if (typeof maxHeightPx === 'function') return maxHeightPx()
  return maxHeightPx
}

function createAnchorElement(
  document: Document,
  className: string,
  anchorName: string,
): HTMLDivElement {
  const element = document.createElement('div')
  element.className = className
  Object.assign(element.style, {
    position: 'fixed',
    display: 'none',
    opacity: '0',
    pointerEvents: 'none',
  })
  element.style.setProperty('anchor-name', anchorName)
  return element
}

/**
 * The anchor stands in for the text the surface belongs to, so it is given that text's rect and
 * nothing else. A degenerate rect — a caret, an empty range — would leave nothing to anchor to, so
 * it is widened to the smallest rect the browser will still lay out.
 */
function positionAnchorElement(element: HTMLDivElement, rect: DOMRect): void {
  Object.assign(element.style, {
    display: 'block',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${Math.max(1, rect.width)}px`,
    height: `${Math.max(1, rect.height)}px`,
  })
}

function applyPlacement(
  element: HTMLElement,
  placement: AnchoredSurfacePlacement,
  alignment: AnchoredSurfaceAlignment,
  gapPx: number,
): void {
  const across = alignment === 'start' ? 'span-right' : 'center'
  element.style.setProperty('position-area', `${placement} ${across}`)
  // The gap is a margin rather than an offset because the position area owns the insets, and a
  // margin is the one thing that still pushes a surface away from its anchor from inside it.
  element.style.setProperty('margin-top', placement === 'bottom' ? `${gapPx}px` : '0')
  element.style.setProperty('margin-bottom', placement === 'top' ? `${gapPx}px` : '0')
}

function surfaceHeight(element: HTMLElement, maxHeightPx: number | undefined): number {
  const measured = element.getBoundingClientRect().height
  if (maxHeightPx === undefined) return measured

  // What the surface would settle at, not what it is showing: a list already clamped to its ceiling
  // must not read as too tall for a side that would hold it at that ceiling.
  return Math.min(measured, maxHeightPx)
}

/**
 * The side the surface goes on: the one asked for while it fits, then the other, then whichever has
 * more room for a surface that fits on neither.
 */
function fittingPlacement(
  anchor: DOMRect,
  height: number,
  viewportHeight: number,
  preferred: AnchoredSurfacePlacement,
  gapPx: number,
  viewportMarginPx: number,
): AnchoredSurfacePlacement {
  const room = (placement: AnchoredSurfacePlacement): number =>
    roomBeside(anchor, placement, viewportHeight, gapPx, viewportMarginPx)
  if (room(preferred) >= height) return preferred

  const fallback = preferred === 'top' ? 'bottom' : 'top'
  if (room(fallback) >= height) return fallback

  return room('top') >= room('bottom') ? 'top' : 'bottom'
}

function roomBeside(
  anchor: DOMRect,
  placement: AnchoredSurfacePlacement,
  viewportHeight: number,
  gapPx: number,
  viewportMarginPx: number,
): number {
  if (placement === 'top') return anchor.top - gapPx - viewportMarginPx
  return viewportHeight - anchor.bottom - gapPx - viewportMarginPx
}

function surfaceCeiling(room: number, maxHeightPx: number): number {
  return Math.max(MIN_SURFACE_HEIGHT_PX, Math.min(maxHeightPx, Math.floor(room)))
}
