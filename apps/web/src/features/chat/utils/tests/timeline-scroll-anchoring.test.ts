import {
  initialTimelineScrollState,
  isTimelineAtContentEnd,
  isTimelineWithinFollowBand,
  resolveTimelineAnchorItemId,
  shouldReleaseTimelineAnchorForActivity,
  timelineAnchoredTurnMetrics,
  timelineContentScrollsUp,
  timelineDistanceToContentEnd,
  timelinePrependedScrollTop,
  timelineRemeasureScrollDelta,
  timelineScrollReducer,
  TIMELINE_ANCHOR_OFFSET_PX,
  TIMELINE_COMPOSER_INSET_PX,
  TIMELINE_TOP_INSET_PX,
  type TimelineScrollState,
  type TimelineViewportMetrics,
} from '@/features/chat/utils/timeline-scroll-anchoring'
import { expect, test } from '../../../../../test/fixtures'
import { workLogEntry } from '../../../../../test/factories/work-log'

const VIEWPORT_HEIGHT = 600

test('live tool activity releases the send-time anchor beside the composer', () => {
  const entry = workLogEntry({ lifecycle: 'running', sourceKind: 'tool.started' })

  expect(
    shouldReleaseTimelineAnchorForActivity([
      {
        activity: { active: true, activities: [entry], entry, label: 'Running rg' },
        id: 'live-activity:turn-1',
        timestamp: entry.createdAt,
        type: 'live-activity',
      },
    ]),
  ).toBe(true)
})

test('reasoning and historical tool groups retain the new-turn anchor', () => {
  const reasoning = workLogEntry({ sourceKind: 'thinking.updated', tone: 'thinking' })
  const tool = workLogEntry()

  expect(
    shouldReleaseTimelineAnchorForActivity([
      {
        activities: [tool],
        id: 'activity-group:old-turn',
        timestamp: tool.createdAt,
        type: 'activity-group',
      },
      {
        activity: { active: true, activities: [reasoning], entry: reasoning, label: 'Thinking' },
        id: 'live-activity:turn-1',
        timestamp: reasoning.createdAt,
        type: 'live-activity',
      },
    ]),
  ).toBe(false)
})

function viewport(overrides: Partial<TimelineViewportMetrics> = {}): TimelineViewportMetrics {
  return {
    contentHeight: 2000,
    scrollTop: 1400,
    viewportHeight: VIEWPORT_HEIGHT,
    ...overrides,
  }
}

function openedSession(
  sessionId = 'ad686244-5b2e-59be-805f-ef86eac80feb',
  latestUserItemId: string | null = 'message:u1',
) {
  return timelineScrollReducer(initialTimelineScrollState, {
    firstItemId: 'message:u1',
    latestUserItemId,
    sessionId,
    type: 'items-changed',
  })
}

/** An items change that adds nothing to the front — the ordinary streaming case. */
function itemsChanged(
  latestUserItemId: string | null,
  sessionId = 'ad686244-5b2e-59be-805f-ef86eac80feb',
) {
  return {
    firstItemId: 'message:u1',
    latestUserItemId,
    sessionId,
    type: 'items-changed',
  } as const
}

function afterInitialScroll(state: TimelineScrollState) {
  return timelineScrollReducer(state, { type: 'initial-scroll-done' })
}

test('the reserved composer space is not unread content', () => {
  // 56px of scroll remains, but 16px of it is the inset below the last row.
  const metrics = viewport({ contentHeight: 2000, scrollTop: 1344 })

  expect(timelineDistanceToContentEnd(metrics, 0)).toBe(56)
  expect(isTimelineWithinFollowBand(metrics, 0)).toBe(false)
  expect(timelineDistanceToContentEnd(metrics, TIMELINE_COMPOSER_INSET_PX)).toBe(40)
  expect(isTimelineWithinFollowBand(metrics, TIMELINE_COMPOSER_INSET_PX)).toBe(true)
})

test('the band is tight enough that reading history is never "at the end"', () => {
  const reading = viewport({ contentHeight: 2000, scrollTop: 1000 })

  expect(isTimelineWithinFollowBand(reading, TIMELINE_COMPOSER_INSET_PX)).toBe(false)
})

test('anchored end space counts as reserved, not as content left to read', () => {
  const anchoredEndSpace = 300
  // Scrolled so the real content bottom sits on the viewport bottom; everything
  // below it is space reserved to let the anchored turn reach the top.
  const parked = viewport({ contentHeight: 2000, scrollTop: 1084 })

  expect(isTimelineWithinFollowBand(parked, TIMELINE_COMPOSER_INSET_PX)).toBe(false)
  expect(isTimelineWithinFollowBand(parked, TIMELINE_COMPOSER_INSET_PX + anchoredEndSpace)).toBe(
    true,
  )
})

test('content that fits the viewport carries no navigation gesture', () => {
  expect(timelineContentScrollsUp(viewport({ contentHeight: 400 }))).toBe(false)
  expect(timelineContentScrollsUp(viewport({ contentHeight: 601 }))).toBe(true)
})

test('the anchor is the last user message', () => {
  const items = [
    { id: 'message:u1', message: { role: 'user' } },
    { id: 'message:a1', message: { role: 'assistant' } },
    { id: 'message:u2', message: { role: 'user' } },
    { id: 'activity-group:1' },
    { id: 'working:1' },
  ]

  expect(resolveTimelineAnchorItemId(items)).toBe('message:u2')
  expect(resolveTimelineAnchorItemId([{ id: 'working:1' }])).toBeNull()
})

test('opening a session lands at the end instead of anchoring its last message', () => {
  const opened = openedSession()

  expect(opened.followMode).toBe('following-end')
  expect(opened.pendingInitialScroll).toBe(true)
  expect(opened.anchorItemId).toBeNull()
  expect(afterInitialScroll(opened).pendingInitialScroll).toBe(false)
})

test('sending a message anchors it instead of pinning to the bottom', () => {
  const state = timelineScrollReducer(
    afterInitialScroll(openedSession()),
    itemsChanged('message:u2'),
  )

  expect(state.followMode).toBe('anchoring-new-turn')
  expect(state.anchorItemId).toBe('message:u2')
  expect(state.parkedAnchorItemId).toBeNull()
})

test('sending while reading history still anchors the sent message', () => {
  const reading = timelineScrollReducer(afterInitialScroll(openedSession()), {
    type: 'user-navigated',
  })

  const sent = timelineScrollReducer(reading, itemsChanged('message:u2'))

  expect(sent.followMode).toBe('anchoring-new-turn')
})

test('streaming into an anchored turn never re-arms end-follow', () => {
  const anchored = timelineScrollReducer(
    afterInitialScroll(openedSession()),
    itemsChanged('message:u2'),
  )

  for (const atContentEnd of [true, false, true]) {
    expect(timelineScrollReducer(anchored, { atContentEnd, type: 'scrolled' })).toBe(anchored)
  }
})

test('a user scrolling up mid-stream stops the transcript following', () => {
  const following = afterInitialScroll(openedSession())
  const navigated = timelineScrollReducer(following, { type: 'user-navigated' })

  expect(navigated.followMode).toBe('free-scrolling')
  // Further stream chunks and their scroll events must not drag them back.
  const streamed = timelineScrollReducer(navigated, itemsChanged('message:u1'))
  expect(streamed).toBe(navigated)
  expect(timelineScrollReducer(navigated, { atContentEnd: false, type: 'scrolled' })).toBe(
    navigated,
  )
})

test('a small scroll off the live edge is not re-armed back into follow', () => {
  // Re-arming here would scroll the transcript straight back to the end, so the
  // reader could never get out of the first gesture's worth of distance.
  const navigated = timelineScrollReducer(afterInitialScroll(openedSession()), {
    type: 'user-navigated',
  })
  const nudgedOffTheEnd = viewport({ contentHeight: 2000, scrollTop: 1390 })

  expect(isTimelineAtContentEnd(nudgedOffTheEnd)).toBe(false)
  expect(timelineScrollReducer(navigated, { atContentEnd: false, type: 'scrolled' })).toBe(
    navigated,
  )
})

test('scrolling back to the very end re-arms follow and releases the anchor', () => {
  const anchored = timelineScrollReducer(
    afterInitialScroll(openedSession()),
    itemsChanged('message:u2'),
  )
  const measured = timelineScrollReducer(anchored, { endSpace: 240, type: 'anchor-measured' })
  const navigated = timelineScrollReducer(measured, { type: 'user-navigated' })

  expect(isTimelineAtContentEnd(viewport({ contentHeight: 2000, scrollTop: 1400 }))).toBe(true)
  const rearmed = timelineScrollReducer(navigated, { atContentEnd: true, type: 'scrolled' })

  expect(rearmed.followMode).toBe('following-end')
  expect(rearmed.anchorItemId).toBeNull()
  expect(rearmed.anchoredEndSpace).toBe(0)
})

test('jumping to the latest message releases the anchor', () => {
  const anchored = timelineScrollReducer(
    afterInitialScroll(openedSession()),
    itemsChanged('message:u2'),
  )
  const parked = timelineScrollReducer(
    timelineScrollReducer(anchored, { endSpace: 240, type: 'anchor-measured' }),
    { type: 'anchor-parked' },
  )

  const jumped = timelineScrollReducer(parked, { type: 'jump-to-end' })

  expect(jumped).toMatchObject({
    anchorItemId: null,
    anchoredEndSpace: 0,
    followMode: 'following-end',
    parkedAnchorItemId: null,
  })
})

test('switching sessions forgets the previous scroll intent', () => {
  const navigated = timelineScrollReducer(afterInitialScroll(openedSession()), {
    type: 'user-navigated',
  })

  const switched = timelineScrollReducer(
    navigated,
    itemsChanged('message:other', '83820f69-dec0-53d9-9ab5-fddbd1dabb2d'),
  )

  expect(switched).toMatchObject({
    anchorItemId: null,
    followMode: 'following-end',
    latestUserItemId: 'message:other',
    pendingInitialScroll: true,
    sessionId: '83820f69-dec0-53d9-9ab5-fddbd1dabb2d',
  })
})

test('unchanged input leaves the state object identical', () => {
  const state = afterInitialScroll(openedSession())

  expect(timelineScrollReducer(state, itemsChanged('message:u1'))).toBe(state)
  expect(timelineScrollReducer(state, { endSpace: 0, type: 'anchor-measured' })).toBe(state)
  expect(timelineScrollReducer(state, { type: 'initial-scroll-done' })).toBe(state)
})

test('a page landing above the reader is marked for absorption', () => {
  const reading = timelineScrollReducer(afterInitialScroll(openedSession()), {
    type: 'user-navigated',
  })

  const prepended = timelineScrollReducer(reading, {
    firstItemId: 'message:older',
    latestUserItemId: 'message:u1',
    sessionId: 'ad686244-5b2e-59be-805f-ef86eac80feb',
    type: 'items-changed',
  })

  expect(prepended.prependedAboveItemId).toBe('message:u1')
  expect(prepended.firstItemId).toBe('message:older')
  expect(prepended.followMode).toBe('free-scrolling')
  expect(timelineScrollReducer(prepended, { type: 'prepend-absorbed' }).prependedAboveItemId).toBe(
    null,
  )
})

test('a front change while following the end is not a prepend to absorb', () => {
  // Pinned to the live edge, the offset is re-derived every frame; compensating
  // for a front change on top of that would fight `scrollToEnd`.
  const following = afterInitialScroll(openedSession())

  const changed = timelineScrollReducer(following, {
    firstItemId: 'message:older',
    latestUserItemId: 'message:u1',
    sessionId: 'ad686244-5b2e-59be-805f-ef86eac80feb',
    type: 'items-changed',
  })

  expect(changed.prependedAboveItemId).toBeNull()
  expect(changed.firstItemId).toBe('message:older')
})

test('sending while a prepend is unabsorbed hands the offset to the anchor', () => {
  const reading = timelineScrollReducer(afterInitialScroll(openedSession()), {
    type: 'user-navigated',
  })
  const prepended = timelineScrollReducer(reading, {
    firstItemId: 'message:older',
    latestUserItemId: 'message:u1',
    sessionId: 'ad686244-5b2e-59be-805f-ef86eac80feb',
    type: 'items-changed',
  })

  const sent = timelineScrollReducer(prepended, {
    firstItemId: 'message:older',
    latestUserItemId: 'message:u2',
    sessionId: 'ad686244-5b2e-59be-805f-ef86eac80feb',
    type: 'items-changed',
  })

  expect(sent.followMode).toBe('anchoring-new-turn')
  expect(sent.prependedAboveItemId).toBeNull()
})

test('the absorbed offset keeps the reader on the same row', () => {
  const scrollTop = 900
  const rowStartBefore = 1_200
  // The page pushed everything down: the previously-first row now starts 640px
  // below the top inset instead of sitting on it.
  const shift = 640
  const scrolled = timelinePrependedScrollTop({
    anchorRow: { size: 40, start: TIMELINE_TOP_INSET_PX + shift },
    scrollTop,
    topInset: TIMELINE_TOP_INSET_PX,
  })

  expect(scrolled).toBe(scrollTop + shift)
  expect(rowStartBefore + shift - (scrolled ?? 0)).toBe(rowStartBefore - scrollTop)
})

test('a page that turned out to be empty moves nothing', () => {
  expect(
    timelinePrependedScrollTop({
      anchorRow: { size: 40, start: TIMELINE_TOP_INSET_PX },
      scrollTop: 900,
      topInset: TIMELINE_TOP_INSET_PX,
    }),
  ).toBeNull()
  expect(
    timelinePrependedScrollTop({ anchorRow: undefined, scrollTop: 900, topInset: 16 }),
  ).toBeNull()
})

test('an anchored turn parks the sent message near the top', () => {
  const metrics = timelineAnchoredTurnMetrics({
    anchorOffset: TIMELINE_ANCHOR_OFFSET_PX,
    anchorRow: { size: 60, start: 1200 },
    endInset: TIMELINE_COMPOSER_INSET_PX,
    lastRow: { size: 60, start: 1200 },
    viewport: viewport({ contentHeight: 1276, scrollTop: 676 }),
  })

  expect(metrics?.parkScrollTop).toBe(1200 - TIMELINE_ANCHOR_OFFSET_PX)
})

test('the reserved end space is exactly what the park needs and no more', () => {
  const anchorRow = { size: 60, start: 1200 }
  const lastRow = { size: 60, start: 1200 }
  const contentBottom = lastRow.start + lastRow.size
  const metrics = timelineAnchoredTurnMetrics({
    anchorOffset: TIMELINE_ANCHOR_OFFSET_PX,
    anchorRow,
    endInset: TIMELINE_COMPOSER_INSET_PX,
    lastRow,
    viewport: viewport({ contentHeight: contentBottom + TIMELINE_COMPOSER_INSET_PX }),
  })
  const maxScrollTop =
    contentBottom + TIMELINE_COMPOSER_INSET_PX + (metrics?.endSpace ?? 0) - VIEWPORT_HEIGHT

  expect(maxScrollTop).toBe(metrics?.parkScrollTop)
})

test('an answer that fits under the anchor never moves the viewport', () => {
  const metrics = timelineAnchoredTurnMetrics({
    anchorOffset: TIMELINE_ANCHOR_OFFSET_PX,
    anchorRow: { size: 60, start: 1200 },
    // Question plus a 300px answer: still inside the usable viewport.
    lastRow: { size: 300, start: 1260 },
    endInset: TIMELINE_COMPOSER_INSET_PX,
    viewport: viewport({ contentHeight: 1900, scrollTop: 1184 }),
  })

  expect(metrics?.overflowsUsableViewport).toBe(false)
  expect(metrics?.scrollDeltaToRevealEnd).toBe(0)
})

test('an answer that outgrows the viewport reveals only the overflow', () => {
  const scrollTop = 1184
  const metrics = timelineAnchoredTurnMetrics({
    anchorOffset: TIMELINE_ANCHOR_OFFSET_PX,
    anchorRow: { size: 60, start: 1200 },
    lastRow: { size: 900, start: 1260 },
    endInset: TIMELINE_COMPOSER_INSET_PX,
    viewport: viewport({ contentHeight: 2176, scrollTop }),
  })
  const usable = VIEWPORT_HEIGHT - TIMELINE_COMPOSER_INSET_PX - TIMELINE_ANCHOR_OFFSET_PX

  expect(metrics?.overflowsUsableViewport).toBe(true)
  expect(metrics?.usableViewportHeight).toBe(usable)
  expect(metrics?.scrollDeltaToRevealEnd).toBe(1260 + 900 - usable - scrollTop)
})

test('a taller composer inset shrinks the usable viewport', () => {
  const input = {
    anchorOffset: TIMELINE_ANCHOR_OFFSET_PX,
    anchorRow: { size: 60, start: 1200 },
    lastRow: { size: 300, start: 1260 },
    viewport: viewport({ contentHeight: 1900, scrollTop: 1184 }),
  }

  const tight = timelineAnchoredTurnMetrics({ ...input, endInset: 240 })
  const roomy = timelineAnchoredTurnMetrics({ ...input, endInset: TIMELINE_COMPOSER_INSET_PX })

  expect(tight?.usableViewportHeight).toBe(600 - 240 - TIMELINE_ANCHOR_OFFSET_PX)
  expect(tight?.overflowsUsableViewport).toBe(true)
  expect(roomy?.overflowsUsableViewport).toBe(false)
  expect(tight?.scrollDeltaToRevealEnd).toBeGreaterThan(roomy?.scrollDeltaToRevealEnd ?? 0)
})

test('unmeasured rows produce no anchor decision', () => {
  const base = {
    anchorOffset: TIMELINE_ANCHOR_OFFSET_PX,
    endInset: TIMELINE_COMPOSER_INSET_PX,
    viewport: viewport(),
  }

  expect(
    timelineAnchoredTurnMetrics({ ...base, anchorRow: undefined, lastRow: { size: 1, start: 0 } }),
  ).toBeNull()
  expect(
    timelineAnchoredTurnMetrics({ ...base, anchorRow: { size: 1, start: 0 }, lastRow: undefined }),
  ).toBeNull()
  expect(
    timelineAnchoredTurnMetrics({
      ...base,
      anchorRow: { size: Number.NaN, start: 0 },
      lastRow: { size: 1, start: 0 },
    }),
  ).toBeNull()
})

test('remeasuring a row above the viewport keeps the visible content still', () => {
  const scrollTop = 1000
  const offScreenRow = { size: 64, start: 400 }
  const visibleRowStart = 1200
  const delta = 120

  const adjustment = timelineRemeasureScrollDelta({
    delta,
    rowStart: offScreenRow.start,
    scrollTop,
    suspended: false,
  })

  // The off-screen row grew, so everything below it moved down by `delta`.
  const visibleTopInViewportBefore = visibleRowStart - scrollTop
  const visibleTopInViewportAfter = visibleRowStart + delta - (scrollTop + adjustment)
  expect(visibleTopInViewportAfter).toBe(visibleTopInViewportBefore)
})

test('remeasuring a row at or below the viewport top needs no compensation', () => {
  const scrollTop = 1000

  expect(
    timelineRemeasureScrollDelta({ delta: 120, rowStart: scrollTop, scrollTop, suspended: false }),
  ).toBe(0)
  expect(
    timelineRemeasureScrollDelta({ delta: 120, rowStart: 1400, scrollTop, suspended: false }),
  ).toBe(0)
})

test('compensation applies while scrolling up, which is when the jump is felt', () => {
  // Nothing in the decision depends on scroll direction — only on position.
  expect(
    timelineRemeasureScrollDelta({ delta: -80, rowStart: 100, scrollTop: 1000, suspended: false }),
  ).toBe(-80)
})

test('a settling disclosure suspends compensation', () => {
  expect(
    timelineRemeasureScrollDelta({ delta: 120, rowStart: 100, scrollTop: 1000, suspended: true }),
  ).toBe(0)
  expect(
    timelineRemeasureScrollDelta({ delta: 0, rowStart: 100, scrollTop: 1000, suspended: false }),
  ).toBe(0)
})
