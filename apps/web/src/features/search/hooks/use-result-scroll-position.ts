import { useLayoutEffect, useState, type RefObject } from 'react'

import { useSearchBufferState } from '@/features/search/state/buffer-state'
import {
  attachSearchResultScroll,
  searchResultScrollState,
  type SearchScrollRow,
} from '@/features/search/state/result-scroll-state'

export function useSearchResultScrollPosition({
  displayedResultsQuery,
  parentRef,
  rootPath,
  scrollToOffsetRef,
  surface = 'editor',
  geometry,
}: {
  readonly displayedResultsQuery: string | null
  readonly parentRef: RefObject<HTMLDivElement | null>
  readonly rootPath?: string
  readonly surface?: 'compact' | 'editor'
  readonly geometry?: readonly SearchScrollRow[]
  readonly scrollToOffsetRef: RefObject<(offset: number) => void>
}) {
  const [standaloneIncarnation] = useState(() => ({}))
  const snapshot = useSearchBufferState((state) => state.active)
  const incarnation =
    !rootPath || snapshot?.rootPath === rootPath
      ? (snapshot?.incarnation ?? standaloneIncarnation)
      : standaloneIncarnation
  const query = snapshot?.resultsSearchQuery
  const identity = query ? JSON.stringify(query, Object.keys(query).sort()) : displayedResultsQuery
  const state = searchResultScrollState(incarnation, surface)

  useLayoutEffect(() => {
    const element = parentRef.current
    if (!element) return

    return attachSearchResultScroll({
      element,
      query: identity,
      scrollToOffset: scrollToOffsetRef.current,
      state,
      geometry,
    })
  }, [identity, geometry, parentRef, scrollToOffsetRef, state])

  return state.read(identity, geometry)
}
