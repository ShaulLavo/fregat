import { useCallback, useLayoutEffect, useRef, type FragmentInstance } from 'react'

import {
  createTabStripMetrics,
  type TabStripMetrics,
} from '@/features/workbench/state/tab-strip-metrics'
import {
  tabStripScrollLeft,
  scrollGutter,
  revealBehavior,
} from '@/features/workbench/utils/tab-strip-scroll'

/**
 * Scrolls the strip to the selected tab. Anything that opens a file — the tree,
 * quick access, a git diff, go-to-definition, a chat checkpoint — selects a tab
 * that may sit outside the scroll window, and nothing else brings it back.
 */
export function useActiveTabStripScroll(
  activeTabId: string | null,
  tabIds: readonly string[],
  onNode?: (node: HTMLDivElement | null) => void,
) {
  const tabsKey = tabIds.join(' ')
  const stripRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<FragmentInstance>(null)
  const metricsRef = useRef<TabStripMetrics | null>(null)
  const hasRevealedRef = useRef(false)

  // A layout effect, and declared above the reveal so it runs first: metrics built in a passive
  // effect do not exist yet on the mount that has to reveal an already-clipped active tab.
  useLayoutEffect(() => {
    const strip = stripRef.current
    if (!strip) return

    const metrics = createTabStripMetrics(strip)
    metricsRef.current = metrics
    if (tabsRef.current) metrics.observeTabs(tabsRef.current)
    return () => {
      hasRevealedRef.current = false
      metricsRef.current = null
      metrics.dispose()
    }
  }, [])

  // Declared above the reveal so a tab opened in this commit voids the cache before it is asked.
  useLayoutEffect(() => {
    metricsRef.current?.noteTabs(tabsKey)
  }, [tabsKey])

  // Layout effect, not effect: starting the scroll after paint shows the old offset for a frame.
  useLayoutEffect(() => {
    const strip = stripRef.current
    const metrics = metricsRef.current
    if (!strip || !metrics || !activeTabId) return

    const bounds = metrics.boundsFor(activeTabId) ?? metrics.measure(activeTabId)
    if (!bounds) return

    const behavior = hasRevealedRef.current ? revealBehavior() : 'instant'
    hasRevealedRef.current = true
    const left = tabStripScrollLeft({ gutter: scrollGutter(strip), ...bounds })
    if (left === null) return

    metrics.noteScrollTarget(left)
    strip.scrollTo({ behavior, left })
  }, [activeTabId])

  // compiler:memos: same keys, but this ref callback must keep identity to avoid DOM/drag re-registration.
  const setStripRef = useCallback(
    (node: HTMLDivElement | null) => {
      stripRef.current = node
      onNode?.(node)
    },
    [onNode],
  )
  return { setStripRef, tabsRef }
}
