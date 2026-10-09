import {
  shouldShowTimelineMinimap,
  timelineMinimapActiveMarkId,
  timelineMinimapKeyTargetIndex,
  timelineMinimapMarks,
  timelineMinimapRovingMarkId,
  timelineMinimapScrollTop,
  timelineMinimapViewportBand,
  TIMELINE_MINIMAP_MIN_TURNS,
  type TimelineMinimapItem,
  type TimelineMinimapMark,
} from '@/features/chat/utils/timeline-minimap'
import {
  TIMELINE_ANCHOR_OFFSET_PX,
  type TimelineRowMetrics,
  type TimelineViewportMetrics,
} from '@/features/chat/utils/timeline-scroll-anchoring'
import { expect, test } from '../../../../../test/fixtures'

const ROW_HEIGHT = 100

/** A user message, an assistant reply and a fold, repeated `turns` times. */
function transcript(turns: number): readonly TimelineMinimapItem[] {
  return Array.from({ length: turns * 3 }, (_unused, index) => {
    if (index % 3 === 0) return { id: `u${index}`, message: { role: 'user' } }
    if (index % 3 === 1) return { id: `a${index}`, message: { role: 'assistant' } }

    return { id: `fold${index}` }
  })
}

function rows(count: number, height = ROW_HEIGHT): readonly TimelineRowMetrics[] {
  return Array.from({ length: count }, (_unused, index) => ({
    size: height,
    start: index * height,
  }))
}

function viewport(overrides: Partial<TimelineViewportMetrics> = {}): TimelineViewportMetrics {
  return { contentHeight: 3000, scrollTop: 0, viewportHeight: 600, ...overrides }
}

function marksOf(turns: number): readonly TimelineMinimapMark[] {
  return timelineMinimapMarks({
    contentHeight: turns * 3 * ROW_HEIGHT,
    items: transcript(turns),
    rows: rows(turns * 3),
  })
}

test('one mark per turn, at the user message that started it', () => {
  const marks = marksOf(3)

  // Only the user messages carry marks — the assistant reply and the fold under
  // each of them belong to the same turn.
  expect(marks.map((mark) => mark.id)).toEqual(['u0', 'u3', 'u6'])
  expect(marks.map((mark) => mark.ordinal)).toEqual([1, 2, 3])
  expect(marks.map((mark) => mark.start)).toEqual([0, 300, 600])
  expect(marks.map((mark) => mark.startFraction)).toEqual([0, 1 / 3, 2 / 3])
})

test('a row the virtualizer has not placed yet gets no mark', () => {
  // Measurements arrive per row; a turn with no geometry has nowhere to sit, and
  // guessing zero would stack it on the transcript's first mark.
  const measuredRows: readonly (TimelineRowMetrics | undefined)[] = rows(3)
  const marks = timelineMinimapMarks({
    contentHeight: 900,
    items: transcript(3),
    rows: measuredRows.concat([undefined, undefined, undefined], rows(3)),
  })

  expect(marks.map((mark) => mark.id)).toEqual(['u0', 'u6'])
  expect(marks.map((mark) => mark.ordinal)).toEqual([1, 2])
})

test('an unmeasured transcript maps to nothing rather than to everything', () => {
  expect(timelineMinimapMarks({ contentHeight: 0, items: transcript(9), rows: rows(27) })).toEqual(
    [],
  )
})

test('the band reports the slice of the transcript on screen', () => {
  const band = timelineMinimapViewportBand(viewport({ scrollTop: 600 }))

  expect(band).toEqual({ endFraction: 0.4, startFraction: 0.2 })
})

test('a viewport scrolled past the content end still reports a band inside the rail', () => {
  // Overscroll and the reserved anchor space both push scrollTop past what the
  // content strictly holds; a band drawn beyond 1 would escape the rail.
  const band = timelineMinimapViewportBand(viewport({ scrollTop: 4000 }))

  expect(band).toEqual({ endFraction: 1, startFraction: 1 })
})

test('the active turn is the one the viewport top is reading', () => {
  const marks = marksOf(3)

  expect(timelineMinimapActiveMarkId({ marks, viewport: viewport({ scrollTop: 0 }) })).toBe('u0')
  expect(timelineMinimapActiveMarkId({ marks, viewport: viewport({ scrollTop: 299 }) })).toBe('u0')
  expect(timelineMinimapActiveMarkId({ marks, viewport: viewport({ scrollTop: 300 }) })).toBe('u3')
  expect(timelineMinimapActiveMarkId({ marks, viewport: viewport({ scrollTop: 900 }) })).toBe('u6')
})

test('scrolled above the first turn, the first turn is still the active one', () => {
  // The top inset sits above every row, so a transcript at the very top has its
  // viewport top above the first mark.
  const marks = marksOf(3)

  expect(timelineMinimapActiveMarkId({ marks, viewport: viewport({ scrollTop: -20 }) })).toBe('u0')
  expect(timelineMinimapActiveMarkId({ marks: [], viewport: viewport() })).toBeNull()
})

test('a jump parks the turn where a freshly sent turn parks', () => {
  const mark = marksOf(3)[1]!

  expect(
    timelineMinimapScrollTop({
      mark,
      topInset: TIMELINE_ANCHOR_OFFSET_PX,
      viewport: viewport({ contentHeight: 900, viewportHeight: 600 }),
    }),
  ).toBe(300 - TIMELINE_ANCHOR_OFFSET_PX)
})

test('a jump never asks for an offset the container would shorten', () => {
  const marks = marksOf(3)

  // The last turn starts 600 down a 900px transcript, but only 300px of scroll
  // exists. Asking for 584 and getting 300 would leave the rail lying about
  // where the viewport is.
  expect(
    timelineMinimapScrollTop({
      mark: marks[2]!,
      topInset: TIMELINE_ANCHOR_OFFSET_PX,
      viewport: viewport({ contentHeight: 900, viewportHeight: 600 }),
    }),
  ).toBe(300)
  expect(
    timelineMinimapScrollTop({
      mark: marks[0]!,
      topInset: TIMELINE_ANCHOR_OFFSET_PX,
      viewport: viewport({ contentHeight: 900, viewportHeight: 600 }),
    }),
  ).toBe(0)
})

test('a rail beside a handful of turns is noise', () => {
  const shortViewport = viewport({ contentHeight: 3000, viewportHeight: 600 })

  expect(
    shouldShowTimelineMinimap({
      markCount: TIMELINE_MINIMAP_MIN_TURNS - 1,
      viewport: shortViewport,
    }),
  ).toBe(false)
  expect(
    shouldShowTimelineMinimap({ markCount: TIMELINE_MINIMAP_MIN_TURNS, viewport: shortViewport }),
  ).toBe(true)
})

test('turns that all fit on screen have nothing to navigate to', () => {
  expect(
    shouldShowTimelineMinimap({
      markCount: TIMELINE_MINIMAP_MIN_TURNS + 4,
      viewport: viewport({ contentHeight: 600, viewportHeight: 600 }),
    }),
  ).toBe(false)
})

test('scrolling does not move the tab stop out from under the keyboard', () => {
  const marks = marksOf(3)

  expect(timelineMinimapRovingMarkId({ activeMarkId: 'u6', focusedMarkId: 'u3', marks })).toBe('u3')
  expect(timelineMinimapRovingMarkId({ activeMarkId: 'u6', focusedMarkId: null, marks })).toBe('u6')
  // A focused turn that fell out of the window hands the stop back to the map.
  expect(timelineMinimapRovingMarkId({ activeMarkId: 'u6', focusedMarkId: 'gone', marks })).toBe(
    'u6',
  )
  expect(timelineMinimapRovingMarkId({ activeMarkId: null, focusedMarkId: null, marks })).toBe('u0')
  expect(
    timelineMinimapRovingMarkId({ activeMarkId: null, focusedMarkId: null, marks: [] }),
  ).toBeNull()
})

test('arrow keys walk the rail without wrapping around its ends', () => {
  expect(timelineMinimapKeyTargetIndex({ count: 5, from: 0, key: 'ArrowUp' })).toBe(0)
  expect(timelineMinimapKeyTargetIndex({ count: 5, from: 4, key: 'ArrowDown' })).toBe(4)
  expect(timelineMinimapKeyTargetIndex({ count: 5, from: 2, key: 'ArrowUp' })).toBe(1)
  expect(timelineMinimapKeyTargetIndex({ count: 5, from: 2, key: 'ArrowDown' })).toBe(3)
  expect(timelineMinimapKeyTargetIndex({ count: 5, from: 2, key: 'Home' })).toBe(0)
  expect(timelineMinimapKeyTargetIndex({ count: 5, from: 2, key: 'End' })).toBe(4)
  expect(timelineMinimapKeyTargetIndex({ count: 5, from: 2, key: 'a' })).toBeNull()
  expect(timelineMinimapKeyTargetIndex({ count: 0, from: 0, key: 'Home' })).toBeNull()
})
