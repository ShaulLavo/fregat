import { prefersReducedMotion } from '@/features/workbench/utils/wallpaper'
import { useCallback, useLayoutEffect, useRef } from 'react'

import {
  createTabStripMetrics,
  type TabStripMetrics,
} from '@/features/workbench/state/tab-strip-metrics'
import { tabStripScrollLeft } from '@/features/workbench/utils/tab-strip-scroll'

/** Matches the strip's `px-2`, so a revealed tab never sits flush against the edge. */
const TAB_STRIP_GUTTER = 8

/**
 * Scrolls the strip to the selected tab. Anything that opens a file — the tree,
 * quick access, a git diff, go-to-definition, a chat checkpoint — selects a tab
 * that may sit outside the scroll window, and nothing else brings it back.
 */
export function useActiveTabStripScroll(
  activeTabId: string | null,
  onNode?: (node: HTMLDivElement | null) => void,
) {
  const stripRef = useRef<HTMLDivElement>(null)
  const metricsRef = useRef<TabStripMetrics | null>(null)
  const hasRevealedRef = useRef(false)

  // A layout effect, and declared above the reveal so it runs first: metrics built in a passive
  // effect do not exist yet on the mount that has to reveal an already-clipped active tab.
  useLayoutEffect(() => {
    const strip = stripRef.current
    if (!strip) return

    const metrics = createTabStripMetrics(strip)
    metricsRef.current = metrics
    return () => {
      hasRevealedRef.current = false
      metricsRef.current = null
      metrics.dispose()
    }
  }, [])

  // Layout effect, not effect: starting the scroll after paint shows the old offset for a frame.
  useLayoutEffect(() => {
    const strip = stripRef.current
    const metrics = metricsRef.current
    if (!strip || !metrics || !activeTabId) return

    const bounds = metrics.boundsFor(activeTabId) ?? metrics.measure(activeTabId)
    if (!bounds) return

    const behavior = hasRevealedRef.current ? revealBehavior() : 'instant'
    hasRevealedRef.current = true
    const left = tabStripScrollLeft({ gutter: TAB_STRIP_GUTTER, ...bounds })
    if (left === null) return

    metrics.noteScrollTarget(left)
    strip.scrollTo({ behavior, left })
  }, [activeTabId])

  // The strip metrics and a drag target can share one stable callback ref.
  return useCallback(
    (node: HTMLDivElement | null) => {
      stripRef.current = node
      onNode?.(node)
    },
    [onNode],
  )
}

/** Motion is the point, but not against the wishes of someone who asked the OS for less of it. */
function revealBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth'
}
