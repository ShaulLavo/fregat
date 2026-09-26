import type { FragmentInstance } from 'react'
import type { TabStripScrollBounds } from '@/features/workbench/utils/tab-strip-scroll'

const TAB_SELECTOR = '[data-editor-tab-id]'
/** A landed smooth scroll rarely stops on the exact pixel it was aimed at. */
const ARRIVAL_EPSILON_PX = 1

type TabStripGeometry = Omit<TabStripScrollBounds, 'gutter'>

export type TabStripMetrics = {
  /** The store's tab order, noted in the commit that renders it. A new order voids the cache. */
  noteTabs(key: string): void
  observeTabs(fragment: FragmentInstance): void
  /** Content-space bounds for a tab, or null when the cache cannot prove it is current. */
  boundsFor(tabId: string): TabStripGeometry | null
  /** The same bounds, measured. The fallback for a strip the cache cannot vouch for. */
  measure(tabId: string): TabStripGeometry | null
  /** Where a reveal just aimed the strip, so the next one reasons about where it will land. */
  noteScrollTarget(value: number): void
  dispose(): void
}

// Cache content-space bounds. During smooth scrolling, the target offset owns visibility.
export function createTabStripMetrics(strip: HTMLElement): TabStripMetrics {
  const offsets = new Map<string, { left: number; width: number }>()
  let tabs: FragmentInstance | null = null
  let scrollLeft = strip.scrollLeft
  let clientWidth = strip.clientWidth
  // The order the store last announced, and the order the cache last measured under.
  let tabsKey = ''
  let measuredKey = ''
  let pendingTarget: number | null = null
  let layoutFrame: number | null = null

  const readLayout = (): void => {
    const stripBox = strip.getBoundingClientRect()
    clientWidth = strip.clientWidth
    scrollLeft = strip.scrollLeft
    offsets.clear()

    for (const element of strip.querySelectorAll<HTMLElement>(TAB_SELECTOR)) {
      const id = element.dataset.editorTabId
      if (!id) continue

      offsets.set(id, contentBox(element.getBoundingClientRect(), stripBox, scrollLeft))
    }

    measuredKey = tabsKey
  }

  const onScroll = (): void => {
    scrollLeft = strip.scrollLeft
    if (pendingTarget === null) return
    if (Math.abs(scrollLeft - pendingTarget) > ARRIVAL_EPSILON_PX) return

    pendingTarget = null
  }

  // A smooth scroll the user interrupts never reaches its target, and a target nothing will reach
  // would answer every later question from a position the strip is not going to.
  const abandonTarget = (): void => {
    pendingTarget = null
    scrollLeft = strip.scrollLeft
  }

  const resize = new ResizeObserver(readLayout)
  resize.observe(strip)
  strip.addEventListener('scroll', onScroll, { passive: true })
  strip.addEventListener('scrollend', abandonTarget)
  strip.addEventListener('wheel', abandonTarget, { passive: true })
  strip.addEventListener('pointerdown', abandonTarget)
  readLayout()

  return {
    observeTabs: (fragment) => {
      tabs?.unobserveUsing(resize)
      tabs = fragment
      fragment.observeUsing(resize)
    },
    noteTabs: (key) => {
      if (tabsKey === key) return
      tabsKey = key
      // Reordering equal-width children changes positions without a resize notification.
      if (layoutFrame !== null) return
      layoutFrame = requestAnimationFrame(() => {
        layoutFrame = null
        readLayout()
      })
    },
    boundsFor: (tabId) => {
      // Observers measure after the commit's layout effects, so a tab added, removed or dragged in
      // this commit has not been measured yet.
      if (measuredKey !== tabsKey) return null

      const tab = offsets.get(tabId)
      if (!tab) return null

      const origin = pendingTarget ?? scrollLeft
      return {
        scrollLeft: origin,
        stripLeft: origin,
        stripRight: origin + clientWidth,
        tabLeft: tab.left,
        tabRight: tab.left + tab.width,
      }
    },
    measure: (tabId) => {
      const tab = strip.querySelector(`[data-editor-tab-id="${CSS.escape(tabId)}"]`)
      if (!tab) return null

      const live = strip.scrollLeft
      const box = contentBox(tab.getBoundingClientRect(), strip.getBoundingClientRect(), live)
      const origin = pendingTarget ?? live
      return {
        scrollLeft: origin,
        stripLeft: origin,
        stripRight: origin + strip.clientWidth,
        tabLeft: box.left,
        tabRight: box.left + box.width,
      }
    },
    noteScrollTarget: (value) => {
      pendingTarget = value
    },
    dispose: () => {
      if (layoutFrame !== null) cancelAnimationFrame(layoutFrame)
      resize.disconnect()
      tabs?.unobserveUsing(resize)
      tabs = null
      strip.removeEventListener('scroll', onScroll)
      strip.removeEventListener('scrollend', abandonTarget)
      strip.removeEventListener('wheel', abandonTarget)
      strip.removeEventListener('pointerdown', abandonTarget)
    },
  }
}

/** A viewport rect placed in the strip's scrollable content, which scrolling does not move. */
function contentBox(
  box: DOMRect,
  stripBox: DOMRect,
  scrollLeft: number,
): { left: number; width: number } {
  return { left: box.left - stripBox.left + scrollLeft, width: box.width }
}
