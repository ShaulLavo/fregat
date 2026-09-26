import { renderHook } from '@testing-library/react'
import { vi } from 'vitest'
import type { Editor } from '@singapore-editor/core/editor'

import { useDiffPanes } from '@/features/editor/hooks/use-diff-panes'
import { expect, test } from '../../../../../test/fixtures'

// The two panes are two editors holding two documents, and nothing below the host keeps them
// together. These are the behaviours that do — driven against a doubled `Editor` rather than a
// mounted one, because the failures worth pinning are about ORDER and ARGUMENTS, and happy-dom
// models neither scrolling nor layout well enough to produce them.

test('a scroll in one pane is mirrored onto the other', () => {
  const { panes, old: left, new: right } = mountPanes()

  panes.handleScroll('old', { left: 0, top: 300 })

  expect(right.position).toEqual({ left: 0, top: 300 })
  expect(left.position).toEqual({ left: 0, top: 0 })
})

test('the horizontal axis is mirrored too, which is the whole reason this is host code', () => {
  // A mirror that quietly dropped `left` would look fine on every vertical test.
  const { panes, new: right } = mountPanes()

  panes.handleScroll('old', { left: 140, top: 20 })

  expect(right.position).toEqual({ left: 140, top: 20 })
})

test('the mirrored pane answering back does not move the pane the reader is driving', () => {
  const { panes, old: left, new: right } = mountPanes()

  panes.handleScroll('old', { left: 0, top: 300 })
  // The mirror already reported its move from inside `setScrollPosition`; a late repeat of it
  // (the browser's own scroll event) changes nothing either.
  panes.handleScroll('new', right.position)

  expect(left.position).toEqual({ left: 0, top: 0 })
})

test('a mirror that cannot scroll as far does not drag the driving pane back to where it stopped', () => {
  // The old pane's longest line is longer, so it has more horizontal room. Mirroring 400 onto a
  // pane that clamps at 150 and then believing the pane's answer would yank the reader back.
  const { panes, old: left, new: right } = mountPanes({ newMaxLeft: 150 })

  panes.handleScroll('old', { left: 400, top: 0 })
  expect(right.position).toEqual({ left: 150, top: 0 })

  panes.handleScroll('new', right.position)

  expect(left.position).toEqual({ left: 0, top: 0 })
})

test('a write that moves the mirror nowhere does not swallow the reader scrolling it next', () => {
  // The failure a one-shot "ignore that pane's next event" flag has: this write lands exactly where
  // the mirror already was, so no answering update ever arrives to clear the flag, and the flag
  // then eats the reader's own scroll of that pane.
  const { panes, old: left, new: right } = mountPanes({ newMaxLeft: 0 })

  panes.handleScroll('old', { left: 90, top: 0 })
  expect(right.position).toEqual({ left: 0, top: 0 })

  panes.handleScroll('new', { left: 0, top: 250 })

  expect(left.position).toEqual({ left: 0, top: 250 })
})

test('an unanswered mirror write does not swallow a later scroll that lands on it', () => {
  // The write to `new` is answered by a reader scroll of `new` onto the position `old` already
  // holds, which exits early — so the entry is never matched. If it stayed armed, the next scroll
  // of `new` that happened to land where the write did would be read as the echo and dropped.
  const { panes, old: left, new: right } = mountPanes()

  panes.handleScroll('old', { left: 0, top: 300 })
  expect(right.position).toEqual({ left: 0, top: 300 })
  panes.handleScroll('new', { left: 0, top: 0 })

  panes.handleScroll('new', { left: 0, top: 300 })

  expect(left.position).toEqual({ left: 0, top: 300 })
})

test('a vertical scroll does not drag the other pane sideways', () => {
  // Horizontal extent is per-pane — each side's content width is its own longest line — so the two
  // legitimately end up at different `scrollLeft`, one of them clamped at its maximum. Mirroring
  // both axes whenever either moved then means scrolling DOWN over the clamped pane writes its
  // stale `left` onto the wide one, which snaps sideways under the reader.
  //
  // Note which pane is which: the yank lands on the pane with room, driven from the pane without.
  const { panes, old: wide, new: narrow } = mountPanes({ newMaxLeft: 0 })

  // The reader scrolls the wide pane right. `handleScroll` only REPORTS a position, so put the
  // pane where the browser would have put it first — otherwise the driver never actually moves and
  // the assertion below passes for the wrong reason.
  wide.setScrollPosition({ left: 150, top: 0 })
  panes.handleScroll('old', { left: 150, top: 0 })
  // The narrow pane cannot follow, so the two diverge — legitimately.
  expect(narrow.position).toEqual({ left: 0, top: 0 })

  // Now they scroll the narrow pane DOWN. Its `left` was already 0 and has not moved.
  panes.handleScroll('new', { left: 0, top: 90 })

  // The wide pane follows vertically and holds its horizontal position.
  expect(wide.position).toEqual({ left: 150, top: 90 })
})

test('focusing one pane collapses the other pane selection without scrolling it', () => {
  const { panes, new: right } = mountPanes()

  panes.handleFocus('old')

  // `reveal: false` is the argument that matters: revealing offset 0 scrolls the idle pane to the
  // top, and the next sync then takes the pane the reader is looking at with it.
  expect(right.setSelection).toHaveBeenCalledWith(0, 0, { reveal: false })
})

test('a stacked pane has nothing to mirror or clear', () => {
  const { panes, old: left, new: right } = mountPanes()

  panes.handleScroll('stacked', { left: 10, top: 10 })
  panes.handleFocus('stacked')

  expect(left.position).toEqual({ left: 0, top: 0 })
  expect(right.position).toEqual({ left: 0, top: 0 })
  expect(right.setSelection).not.toHaveBeenCalled()
})

type FakeEditor = {
  position: { left: number; top: number }
  setSelection: ReturnType<typeof vi.fn>
}

/** An `Editor` reduced to the methods this controller drives, plus a clamp to model a pane that
 *  cannot scroll as far as its sibling. Like the real one, it reports a move from inside
 *  `setScrollPosition` (`onDidScroll`), and only when the position changed. */
function fakeEditor(
  maxLeft: number,
  report: (position: { left: number; top: number }) => void,
): FakeEditor & Editor {
  const state: FakeEditor = { position: { left: 0, top: 0 }, setSelection: vi.fn() }

  return {
    getScrollPosition: () => state.position,
    setScrollPosition: (next: { left?: number; top?: number }) => {
      const moved = {
        left: Math.min(next.left ?? state.position.left, maxLeft),
        top: next.top ?? state.position.top,
      }
      if (moved.left === state.position.left && moved.top === state.position.top) return
      state.position = moved
      report(moved)
    },
    get setSelection() {
      return state.setSelection
    },
    get position() {
      return state.position
    },
  } as unknown as FakeEditor & Editor
}

function mountPanes({ newMaxLeft = Number.POSITIVE_INFINITY } = {}) {
  const { result } = renderHook(() => useDiffPanes())
  const left = fakeEditor(Number.POSITIVE_INFINITY, (position) =>
    result.current.handleScroll('old', position),
  )
  const right = fakeEditor(newMaxLeft, (position) => result.current.handleScroll('new', position))
  result.current.registerEditor('old', left)
  result.current.registerEditor('new', right)

  return { new: right, old: left, panes: result.current }
}
