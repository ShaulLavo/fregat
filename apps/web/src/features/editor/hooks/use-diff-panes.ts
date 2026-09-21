import type { Editor } from '@singapore-editor/core/editor'
import type { DiffGutterSide } from '@singapore-editor/diff'
import { useRef } from 'react'

import type { DiffScrollPosition } from '@/features/editor/utils/diff-scroll-bridge'

type DiffSplitSide = Exclude<DiffGutterSide, 'stacked'>

export type DiffPanesController = {
  registerEditor(side: DiffGutterSide, editor: Editor | null): void
  handleFocus(side: DiffGutterSide): void
  handleScroll(side: DiffGutterSide, position: DiffScrollPosition): void
}

/**
 * The two behaviours split mode owes that a single pane does not: both axes scroll together, and
 * only one pane holds a selection.
 *
 * The callbacks are stable because the panes hang layout effects and a plugin instance off them —
 * a fresh identity per render would re-register the scroll bridge on every frame.
 */
export function useDiffPanes(): DiffPanesController {
  const editors = useRef(new Map<DiffGutterSide, Editor>())
  // The last position each side reported, so a sync can tell which AXIS actually moved. `from`
  // alone cannot: it is a position, not a delta.
  const lastSeen = useRef(new Map<DiffGutterSide, DiffScrollPosition>())
  // Where our own last write left the mirrored pane, so its answering scroll can be told apart
  // from a reader scrolling it. Without this the mirror mirrors back, and a pane that clamps — a
  // shorter longest line, so less room to scroll horizontally — drags the pane the reader is
  // actually driving back with it.
  //
  // Matched on position rather than being a one-shot flag for that side. A write that lands
  // exactly where the pane already was emits no scroll event at all, and a bare flag would then
  // stay armed and swallow the reader's next scroll of that pane instead.
  const echo = useRef<{ side: DiffGutterSide; top: number; left: number } | null>(null)

  const registerEditor = (side: DiffGutterSide, editor: Editor | null) => {
    if (editor) {
      editors.current.set(side, editor)
      return
    }

    editors.current.delete(side)
    lastSeen.current.delete(side)
    if (echo.current?.side === side) echo.current = null
  }

  const handleScroll = (side: DiffGutterSide, from: DiffScrollPosition) => {
    const pending = echo.current
    // Spent by the FIRST update from that side, whether or not it is the one we were waiting for.
    // Clearing it only on an exact match leaves it armed whenever the update we get instead exits
    // early below — a reader scrolling the mirrored pane onto the position the other one already
    // holds does exactly that — and the stale entry then swallows a later scroll that happens to
    // land where our write did.
    if (pending?.side === side) echo.current = null
    if (isEcho(pending, side, from)) return

    const target = otherSide(side)
    if (!target) return

    const mirror = editors.current.get(target)
    if (!mirror) return

    // Per axis, and this is the part that is easy to get wrong. Horizontal extent is per-pane —
    // each side's content width is its own longest line — so the two can legitimately sit at
    // different `scrollLeft`, one of them clamped at its maximum. Mirroring both axes whenever
    // either moved then means a purely VERTICAL scroll over the clamped pane writes its stale
    // `left` onto the other one, and the wide pane snaps sideways while the reader is scrolling
    // down. Only the axis that actually moved is carried across.
    const previous = lastSeen.current.get(side)
    lastSeen.current.set(side, from)
    const to = mirror.getScrollPosition()
    const top = !previous || previous.top !== from.top ? from.top : to.top
    const left = !previous || previous.left !== from.left ? from.left : to.left
    if (top === to.top && left === to.left) return

    // Verbatim on the axis that moved, with no compensation for a pane that cannot scroll as far —
    // the same contract the old view had. The panes silently desynchronise horizontally until the
    // driving one scrolls back into the other's range.
    mirror.setScrollPosition({ left, top })
    // Read back rather than remembering what was asked for: `setScrollPosition` clamps, and it is
    // where the pane *landed* that its own scroll event will report.
    const landed = mirror.getScrollPosition()
    echo.current = { left: landed.left, side: target, top: landed.top }
    // Remember where we put it, so when the reader later scrolls THAT pane we can still tell which
    // axis they moved. Without this the first event from a pane has no previous to compare against
    // and carries both axes — which is the yank above, just one gesture later.
    lastSeen.current.set(target, landed)
  }

  const handleFocus = (side: DiffGutterSide) => {
    const target = otherSide(side)
    if (!target) return

    // `reveal: false`, or collapsing the idle pane's selection scrolls it to the top and takes the
    // pane the reader is looking at with it on the next sync.
    editors.current.get(target)?.setSelection(0, 0, { reveal: false })
  }

  return { handleFocus, handleScroll, registerEditor }
}

function isEcho(
  echo: { side: DiffGutterSide; top: number; left: number } | null,
  side: DiffGutterSide,
  position: DiffScrollPosition,
): boolean {
  if (!echo || echo.side !== side) return false

  return echo.top === position.top && echo.left === position.left
}

function otherSide(side: DiffGutterSide): DiffSplitSide | null {
  if (side === 'old') return 'new'
  if (side === 'new') return 'old'

  return null
}
