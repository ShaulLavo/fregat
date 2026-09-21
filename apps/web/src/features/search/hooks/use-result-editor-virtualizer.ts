import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { useRowHeight } from '@workspace/ui/patterns/use-row-height'

import type {
  SearchResultEditorScrollToIndex,
  SearchResultEditorVirtualizer,
} from '@/features/search/utils/result-editor-types'
import {
  searchResultVirtualRowInputs,
  searchResultVirtualViewportHeight,
} from '@/features/search/utils/result-editor'
import type { SearchResultVirtualRow } from '@/features/search/utils/result-view-model'
import {
  createSearchResultVirtualListMetrics,
  type SearchResultVirtualListViewport,
} from '@/features/search/utils/result-virtual-list'
import {
  SearchResultVirtualWindowStore,
  type SearchResultVirtualWindow,
} from '@/features/search/state/result-virtual-window-store'

export type SearchResultScrollSyncMode = 'raf' | 'sync'

export function useSearchResultEditorVirtualizer(
  rows: readonly SearchResultVirtualRow[],
  parentRef: RefObject<HTMLDivElement | null>,
  scrollSyncMode: SearchResultScrollSyncMode = 'raf',
  initialViewport?: SearchResultVirtualListViewport,
): SearchResultEditorVirtualizer {
  const headerHeight = useRowHeight(parentRef)
  const itemInputs = searchResultVirtualRowInputs(rows, headerHeight)
  const metrics = createSearchResultVirtualListMetrics(itemInputs)
  const [store] = useState(() => new SearchResultVirtualWindowStore({ metrics, initialViewport }))
  const [windowState, setWindowState] = useState<SearchResultVirtualWindow>(() => store.getWindow())

  useLayoutEffect(() => {
    store.setChangeHandler(setWindowState)

    return () => store.setChangeHandler(null)
  }, [store])

  useLayoutEffect(() => {
    store.setMetrics(metrics)
  }, [metrics, store])

  useEffect(() => () => store.dispose(), [store])

  useEffect(() => {
    const element = parentRef.current
    if (!element) return

    const handleScroll = () => {
      if (scrollSyncMode === 'sync') {
        flushSync(() => {
          store.setScrollTop(element.scrollTop, { publish: 'sync' })
        })
        return
      }

      store.setScrollTop(element.scrollTop, { publish: 'defer' })
    }

    element.addEventListener('scroll', handleScroll, { passive: true })
    store.setScrollTop(element.scrollTop, {
      publish: 'sync',
      updateVelocity: false,
    })

    return () => element.removeEventListener('scroll', handleScroll)
  }, [parentRef, scrollSyncMode, store])

  useEffect(() => {
    const element = parentRef.current
    if (!element) return
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return

      store.setViewportHeight(searchResultVirtualViewportHeight(entry))
    })
    observer.observe(element)

    return () => observer.disconnect()
  }, [parentRef, store])

  const scrollToOffset = (offset: number) => {
    const element = parentRef.current
    if (!element) return

    store.setViewportHeight(element.clientHeight)
    const top = store.scrollTopForOffset(offset)
    element.scrollTop = top
    store.setScrollTop(top, {
      publish: 'sync',
      updateVelocity: false,
    })
  }
  const scrollToIndex: SearchResultEditorScrollToIndex = (index, target) => {
    const element = parentRef.current
    if (!element) return

    const nextTop = store.scrollTopForIndex(index, target)
    if (nextTop === null) return

    element.scrollTop = nextTop
    store.setScrollTop(nextTop, {
      publish: 'sync',
      updateVelocity: false,
    })
  }

  return {
    items: windowState.items,
    scrollToIndex,
    scrollToOffset,
    totalSize: windowState.totalSize,
    viewport: windowState.viewport,
  }
}
