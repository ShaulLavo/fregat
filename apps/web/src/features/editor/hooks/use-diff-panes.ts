import type { Editor } from '@singapore-editor/core/editor'
import type { DiffGutterSide } from '@singapore-editor/diff'
import { useRef } from 'react'

import type { DiffScrollPosition } from '@/features/editor/state/tab-presentation'

type DiffSplitSide = Exclude<DiffGutterSide, 'stacked'>

export type DiffPanesController = {
  registerEditor(side: DiffGutterSide, editor: Editor | null): void
  handleFocus(side: DiffGutterSide): void
  handleScroll(
    side: DiffGutterSide,
    position: DiffScrollPosition,
    kind: 'restoration' | 'scroll',
  ): void
}

/**
 * The two behaviours split mode owes that a single pane does not: both axes scroll together, and
 * only one pane holds a selection.
 *
 * The callbacks are stable because the panes hang layout effects and a plugin instance off them —
 * a fresh identity per render would resubscribe each pane's scroll listener on every frame.
 */
export function useDiffPanes(): DiffPanesController {
  const editors = useRef(new Map<DiffGutterSide, Editor>())
  // The last position each side reported, so a sync can tell which AXIS actually moved. `from`
  // alone cannot: it is a position, not a delta.
  const lastSeen = useRef(new Map<DiffGutterSide, DiffScrollPosition>())
  // The pane being mirrored reports its move from inside our `setScrollPosition` call, before it
  // returns, so that report is recognised by who is moving rather than guessed from its position.
  const mirroring = useRef<DiffGutterSide | null>(null)
  // Split rows are paired, so the panes share one vertical offset. A refresh resolves each pane's
  // own source anchor, and inside a replaced block those land on different rows; the pane the
  // reader last scrolled or focused keeps its place and the other follows it.
  const leader = useRef<DiffSplitSide>('new')

  const registerEditor = (side: DiffGutterSide, editor: Editor | null) => {
    if (editor) {
      editors.current.set(side, editor)
      return
    }

    editors.current.delete(side)
    lastSeen.current.delete(side)
  }

  const handleScroll = (
    side: DiffGutterSide,
    from: DiffScrollPosition,
    kind: 'restoration' | 'scroll',
  ) => {
    if (mirroring.current === side) {
      lastSeen.current.set(side, from)
      return
    }
    if (kind === 'restoration') {
      lastSeen.current.set(side, from)
      alignToLeader(side)
      return
    }

    const target = otherSide(side)
    if (!target) return
    leader.current = target === 'new' ? 'old' : 'new'

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
    mirroring.current = target
    mirror.setScrollPosition({ left, top })
    mirroring.current = null
    // A write the pane clamps to where it already was reports nothing; read where it stands.
    lastSeen.current.set(target, mirror.getScrollPosition())
  }

  const alignToLeader = (side: DiffGutterSide) => {
    if (!otherSide(side)) return
    const follower = otherSide(leader.current)!
    const lead = editors.current.get(leader.current)
    const mirror = editors.current.get(follower)
    if (!lead || !mirror) return
    const top = lead.getScrollPosition().top
    if (mirror.getScrollPosition().top === top) return

    mirroring.current = follower
    mirror.setScrollPosition({ top })
    mirroring.current = null
    lastSeen.current.set(follower, mirror.getScrollPosition())
  }

  const handleFocus = (side: DiffGutterSide) => {
    const target = otherSide(side)
    if (!target) return
    leader.current = target === 'new' ? 'old' : 'new'

    // `reveal: false`, or collapsing the idle pane's selection scrolls it to the top and takes the
    // pane the reader is looking at with it on the next sync.
    editors.current.get(target)?.setSelection(0, 0, { reveal: false })
  }

  return { handleFocus, handleScroll, registerEditor }
}

function otherSide(side: DiffGutterSide): DiffSplitSide | null {
  if (side === 'old') return 'new'
  if (side === 'new') return 'old'

  return null
}
