import { useEffect, useEffectEvent, useRef } from 'react'

import { useNavigation } from '@/hooks/use-navigation'
import { PAGE_LOCAL_ENTRY_KEY as DEPTH_KEY } from '@/state/navigation-coordinator'

function entryDepth(state: unknown) {
  const depth = (state as Record<string, unknown> | undefined)?.[DEPTH_KEY]
  return typeof depth === 'number' ? depth : null
}

function markEntry(depth: number | null) {
  const { [DEPTH_KEY]: _previous, ...state } = window.history.state ?? {}
  window.history.replaceState(depth === null ? state : { ...state, [DEPTH_KEY]: depth }, '')
}

/**
 * Gives the phone picker one browser history entry per folder it has opened, so the system Back
 * gesture previews and returns to the previous folder, and closes the picker from the first one.
 * Safari's swipe shows the entry it returns to, so blocking the pop would show the wrong screen.
 *
 * The entries copy the router's own state, so the router keeps the page. While they exist the
 * page's own entry is marked too, so returning to it is not a navigation that reapplies the
 * address over a project the pick opened. `leave` returns there, and runs `after` once the router
 * has settled the return.
 */
export function usePickerBackGesture({
  active,
  depth,
  onBack,
  onClose,
}: {
  active: boolean
  depth: number
  onBack: () => void
  onClose: () => void
}) {
  const router = useNavigation().router
  const history = router.history
  // Entries above the page's own: the picker's first folder is entry 1.
  const pushed = useRef(0)
  const afterLeave = useRef<(() => void) | null>(null)
  const back = useEffectEvent(onBack)
  const close = useEffectEvent(onClose)

  useEffect(() => {
    if (!active) return
    const target = depth + 1
    if (pushed.current > target) {
      window.history.go(target - pushed.current)
      pushed.current = target
      return
    }
    if (pushed.current === 0) markEntry(0)
    while (pushed.current < target) {
      pushed.current += 1
      window.history.pushState({ ...window.history.state, [DEPTH_KEY]: pushed.current }, '')
    }
  }, [active, depth])

  // Closed by its owner rather than through `leave`: drop the entries the pick no longer needs.
  // A check on close, not an effect cleanup, so a remounting effect never pops a live entry.
  useEffect(() => {
    if (active || pushed.current === 0) return
    window.history.go(-pushed.current)
  }, [active])

  useEffect(
    () =>
      history.subscribe(({ action }) => {
        if (action.type === 'PUSH' || action.type === 'REPLACE') return
        const reached = entryDepth(window.history.state)
        if (reached === null || reached >= pushed.current) return

        pushed.current = reached
        if (reached > 0) return back()

        markEntry(null)
        const after = afterLeave.current
        afterLeave.current = null
        if (!after) return close()
        // The router is still settling this pop; a navigation the pick starts now would lose to it.
        const settled = router.subscribe('onResolved', () => {
          settled()
          after()
        })
      }),
    [history, router],
  )

  function leave(after: () => void) {
    if (pushed.current === 0) return after()
    if (afterLeave.current) return

    afterLeave.current = after
    window.history.go(-pushed.current)
  }

  return { leave }
}
