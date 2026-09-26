import type { ChatTimelineItem } from '@/features/chat/utils/timeline-items'
import { isWorkLogToolEntry } from '@/features/chat/utils/tool-label'

/**
 * Every scroll decision the chat transcript makes, as pure functions over
 * geometry. The component owns the DOM and the virtualizer; it never decides
 * *whether* or *where* to scroll, only applies what this module returns.
 */

/**
 * How close to the real content end still counts as "at the end" when deciding
 * whether a gesture is navigation. Deliberately tight: a generous band reads a
 * reader moving through history as sitting at the live edge.
 */
const TIMELINE_FOLLOW_REARM_BAND_PX = 40

/**
 * Slack allowed when testing whether the viewport is parked on the scroll
 * bottom, here and as the virtualizer's `scrollEndThreshold`. Only
 * fractional-pixel noise, never a usable gesture distance — a band here would
 * swallow small scrolls whole (see `isTimelineAtContentEnd`).
 */
export const TIMELINE_END_THRESHOLD_PX = 2

/**
 * Space reserved below the last row so the final line never sits flush against
 * the composer. It is part of the scrollable content, so distance-to-end has to
 * subtract it to measure the distance to the *real* content bottom.
 */
export const TIMELINE_COMPOSER_INSET_PX = 16

/** Matching breathing room above the first row. */
export const TIMELINE_TOP_INSET_PX = 16

/** How far below the viewport top a newly sent message parks. */
export const TIMELINE_ANCHOR_OFFSET_PX = 16

/**
 * `following-end` pins to the live edge. `anchoring-new-turn` parks the message
 * the user just sent near the top and lets the answer unroll beneath it — the
 * whole point is that the text being read does not move. `free-scrolling` is the
 * user reading history: nothing moves the viewport until they come back.
 */
type TimelineFollowMode = 'anchoring-new-turn' | 'following-end' | 'free-scrolling'

/** Viewport geometry, in the scroll container's own coordinate space. */
export interface TimelineViewportMetrics {
  /** `scrollHeight` — includes both insets and any anchored end space. */
  readonly contentHeight: number
  readonly scrollTop: number
  /** `clientHeight`. */
  readonly viewportHeight: number
}

/** One row's measured or estimated geometry, in the same coordinate space. */
export interface TimelineRowMetrics {
  readonly size: number
  readonly start: number
}

export interface TimelineAnchoredTurnMetrics {
  readonly anchorTop: number
  readonly contentBottom: number
  /** Extra scrollable space needed below the last row so the anchor can reach the top. */
  readonly endSpace: number
  readonly overflowsUsableViewport: boolean
  /** Scroll offset that parks the anchor `anchorOffset` px below the viewport top. */
  readonly parkScrollTop: number
  /** How far down to scroll to bring the growing end back into view — 0 while it already fits. */
  readonly scrollDeltaToRevealEnd: number
  readonly turnHeight: number
  readonly usableViewportHeight: number
}

export interface TimelineScrollState {
  readonly anchorItemId: string | null
  readonly anchoredEndSpace: number
  readonly followMode: TimelineFollowMode
  readonly latestUserItemId: string | null
  readonly parkedAnchorItemId: string | null
  readonly pendingInitialScroll: boolean
  readonly sessionId: string | null
}

export type TimelineScrollEvent =
  | { readonly endSpace: number; readonly type: 'anchor-measured' }
  | { readonly type: 'anchor-parked' }
  | { readonly type: 'initial-scroll-done' }
  | { readonly type: 'jump-to-end' }
  | { readonly type: 'user-navigated' }
  | { readonly type: 'scrolled'; readonly atContentEnd: boolean }
  | {
      readonly latestUserItemId: string | null
      readonly sessionId: string
      readonly type: 'items-changed'
      readonly preserveReadingPosition?: boolean
    }

export const initialTimelineScrollState: TimelineScrollState = {
  anchorItemId: null,
  anchoredEndSpace: 0,
  followMode: 'following-end',
  latestUserItemId: null,
  parkedAnchorItemId: null,
  pendingInitialScroll: false,
  sessionId: null,
}

/** Distance from the viewport bottom down to the real content bottom. */
export function timelineDistanceToContentEnd(
  viewport: TimelineViewportMetrics,
  endInset: number,
): number {
  return viewport.contentHeight - viewport.scrollTop - viewport.viewportHeight - endInset
}

export function isTimelineWithinFollowBand(
  viewport: TimelineViewportMetrics,
  endInset: number,
): boolean {
  return timelineDistanceToContentEnd(viewport, endInset) <= TIMELINE_FOLLOW_REARM_BAND_PX
}

/**
 * Whether the viewport is parked on the scroll bottom, which is the only thing
 * that re-arms end-follow.
 *
 * It has to be the true bottom rather than "near the end". Re-arming yanks the
 * viewport back to the live edge, so any tolerance is a dead zone the reader
 * cannot scroll out of: every small gesture lands inside it, re-arms follow, and
 * gets undone before the next one. Escaping would take a single scroll longer
 * than the tolerance — which is exactly the transcript fighting back.
 */
export function isTimelineAtContentEnd(viewport: TimelineViewportMetrics): boolean {
  return timelineDistanceToContentEnd(viewport, 0) <= TIMELINE_END_THRESHOLD_PX
}

/** Content short enough to fit the viewport cannot carry a navigation gesture. */
export function timelineContentScrollsUp(viewport: TimelineViewportMetrics): boolean {
  return viewport.contentHeight - viewport.viewportHeight > 0
}

/** The id of the last user message, which is what a new turn anchors to. */
export function resolveTimelineAnchorItemId(
  items: readonly { readonly id: string; readonly message?: { readonly role: string } }[],
): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.message?.role !== 'user') continue

    return item.id
  }

  return null
}

export function shouldReleaseTimelineAnchorForActivity(items: readonly ChatTimelineItem[]) {
  return items.some(
    (item) => item.type === 'live-activity' && item.activity.activities.some(isWorkLogToolEntry),
  )
}

export function timelineAnchoredTurnMetrics({
  anchorOffset,
  anchorRow,
  endInset,
  lastRow,
  viewport,
}: {
  anchorOffset: number
  anchorRow: TimelineRowMetrics | undefined
  endInset: number
  lastRow: TimelineRowMetrics | undefined
  viewport: TimelineViewportMetrics
}): TimelineAnchoredTurnMetrics | null {
  if (!isMeasuredRow(anchorRow)) return null
  if (!isMeasuredRow(lastRow)) return null

  const anchorTop = anchorRow.start
  // A zero-height last row would make the turn look already-revealed.
  const contentBottom = lastRow.start + Math.max(1, lastRow.size)
  const usableViewportHeight = Math.max(0, viewport.viewportHeight - endInset - anchorOffset)
  const turnHeight = Math.max(0, contentBottom - anchorTop)
  const targetScrollToRevealEnd = Math.max(0, contentBottom - usableViewportHeight)

  return {
    anchorTop,
    contentBottom,
    endSpace: Math.max(0, usableViewportHeight - turnHeight),
    overflowsUsableViewport: turnHeight > usableViewportHeight,
    parkScrollTop: Math.max(0, anchorTop - anchorOffset),
    scrollDeltaToRevealEnd: Math.max(0, targetScrollToRevealEnd - viewport.scrollTop),
    turnHeight,
    usableViewportHeight,
  }
}

export function timelineScrollReducer(
  state: TimelineScrollState,
  event: TimelineScrollEvent,
): TimelineScrollState {
  switch (event.type) {
    case 'items-changed':
      return reduceItemsChanged(state, event)
    case 'initial-scroll-done':
      if (!state.pendingInitialScroll) return state

      return { ...state, pendingInitialScroll: false }
    case 'anchor-measured':
      if (state.anchoredEndSpace === event.endSpace) return state

      return { ...state, anchoredEndSpace: event.endSpace }
    case 'anchor-parked':
      if (state.parkedAnchorItemId === state.anchorItemId) return state

      return { ...state, parkedAnchorItemId: state.anchorItemId }
    case 'scrolled':
      return reduceScrolled(state, event.atContentEnd)
    case 'user-navigated':
      if (state.followMode === 'free-scrolling') return state

      return { ...state, followMode: 'free-scrolling' }
    case 'jump-to-end':
      return { ...state, ...releasedAnchor(), followMode: 'following-end' }
  }
}

function reduceItemsChanged(
  state: TimelineScrollState,
  {
    latestUserItemId,
    sessionId,
    preserveReadingPosition,
  }: Extract<TimelineScrollEvent, { type: 'items-changed' }>,
): TimelineScrollState {
  if (sessionId !== state.sessionId) {
    return {
      ...initialTimelineScrollState,
      latestUserItemId,
      pendingInitialScroll: true,
      sessionId,
    }
  }

  if (latestUserItemId === state.latestUserItemId) return state
  if (latestUserItemId === null) return { ...state, latestUserItemId: null }
  if (preserveReadingPosition && state.followMode === 'free-scrolling')
    return { ...state, latestUserItemId }

  // A brand new user message means the user just sent something: park it near
  // the top instead of pinning to the bottom, even if they were reading history.
  return {
    ...state,
    anchorItemId: latestUserItemId,
    followMode: 'anchoring-new-turn',
    latestUserItemId,
    parkedAnchorItemId: null,
  }
}

function reduceScrolled(state: TimelineScrollState, atContentEnd: boolean): TimelineScrollState {
  // Scroll events cannot tell a gesture from our own programmatic move, so they
  // never break follow — only an explicit navigation does. While anchoring they
  // do not re-arm either, or the first streamed chunk would repin to the bottom
  // and undo the anchor.
  if (state.followMode === 'anchoring-new-turn') return state
  if (!atContentEnd) return state
  if (state.followMode === 'following-end') return state

  // Back at the live edge: release the anchor. Its reserved end space sits
  // entirely below the viewport at this point, so collapsing it moves nothing.
  return { ...state, ...releasedAnchor(), followMode: 'following-end' }
}

function releasedAnchor() {
  return {
    anchorItemId: null,
    anchoredEndSpace: 0,
    parkedAnchorItemId: null,
  }
}

function isMeasuredRow(row: TimelineRowMetrics | undefined): row is TimelineRowMetrics {
  if (!row) return false

  return Number.isFinite(row.start) && Number.isFinite(row.size)
}
