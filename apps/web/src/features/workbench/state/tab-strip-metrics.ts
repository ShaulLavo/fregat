import type { TabStripScrollBounds } from '@/features/workbench/utils/tab-strip-scroll'

const TAB_SELECTOR = '[data-editor-tab-id]'
/** A landed smooth scroll rarely stops on the exact pixel it was aimed at. */
const ARRIVAL_EPSILON_PX = 1

type TabStripGeometry = Omit<TabStripScrollBounds, 'gutter'>

export type TabStripMetrics = {
  /** Content-space bounds for a tab, or null when the cache cannot prove it is current. */
  boundsFor(tabId: string): TabStripGeometry | null
  /** The same bounds, measured. The fallback for a strip the cache cannot vouch for. */
  measure(tabId: string): TabStripGeometry | null
  /** Where a reveal just aimed the strip, so the next one reasons about where it will land. */
  noteScrollTarget(value: number): void
  dispose(): void
}

/**
 * Tab offsets kept outside the render, so revealing the active tab is arithmetic instead of a pair
 * of `getBoundingClientRect` calls. Those ran in a layout effect, right after React had rewritten
 * the editor beneath them, and forced a full layout 36 times in a 22s profile — almost always to
 * conclude the tab was already visible.
 *
 * Everything is in the strip's content space, and the window is reported at the offset the strip is
 * *heading* for. A reveal animates, so asking whether a tab is visible where the strip happens to
 * be mid-flight would let a switch decide to do nothing and then be carried somewhere the tab is
 * not. Measurements are taken from observer callbacks, which run after layout, so they are free.
 */
export function createTabStripMetrics(strip: HTMLElement): TabStripMetrics {
  const offsets = new Map<string, { left: number; width: number }>()
  const observed = new Set<Element>()
  let scrollLeft = strip.scrollLeft
  let clientWidth = strip.clientWidth
  let signature = ''
  let pendingTarget: number | null = null

  const readLayout = (): void => {
    const stripBox = strip.getBoundingClientRect()
    clientWidth = strip.clientWidth
    scrollLeft = strip.scrollLeft
    offsets.clear()

    const ids: string[] = []
    const present = new Set<Element>()
    for (const element of strip.querySelectorAll<HTMLElement>(TAB_SELECTOR)) {
      const id = element.dataset.editorTabId
      if (!id) continue

      ids.push(id)
      present.add(element)
      offsets.set(id, contentBox(element.getBoundingClientRect(), stripBox, scrollLeft))
    }

    signature = ids.join(' ')
    syncObserved(present)
  }

  // Each tab is watched too: a rename changes a width without changing the strip's own box, and a
  // width the cache has not caught up with would reveal the tab to the wrong offset.
  const syncObserved = (present: Set<Element>): void => {
    for (const element of observed) {
      if (present.has(element)) continue

      resize.unobserve(element)
      observed.delete(element)
    }
    for (const element of present) {
      if (observed.has(element)) continue

      resize.observe(element)
      observed.add(element)
    }
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
  const mutations = new MutationObserver(readLayout)
  resize.observe(strip)
  mutations.observe(strip, { childList: true, subtree: true })
  strip.addEventListener('scroll', onScroll, { passive: true })
  strip.addEventListener('scrollend', abandonTarget)
  strip.addEventListener('wheel', abandonTarget, { passive: true })
  strip.addEventListener('pointerdown', abandonTarget)
  readLayout()

  return {
    boundsFor: (tabId) => {
      // Cheap because it touches the DOM tree and no geometry: a tab added, removed or dragged
      // since the last observer callback changes this before it changes any measurement.
      if (currentSignature(strip) !== signature) return null

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
      const tab = strip.querySelector(`[data-editor-tab-id="${tabId}"]`)
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
      resize.disconnect()
      mutations.disconnect()
      observed.clear()
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

function currentSignature(strip: HTMLElement): string {
  const ids: string[] = []
  for (const element of strip.querySelectorAll<HTMLElement>(TAB_SELECTOR)) {
    const id = element.dataset.editorTabId
    if (id) ids.push(id)
  }

  return ids.join(' ')
}
