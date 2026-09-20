import { useLayoutEffect, useState, type RefObject } from 'react'

import { useSearchBufferValue } from '@/features/search/hooks/use-buffer-value'
import {
  attachSearchResultScroll,
  searchResultScrollState,
} from '@/features/search/state/result-scroll-state'

export function useSearchResultScrollPosition({
  displayedResultsQuery,
  parentRef,
  rootPath,
  scrollToOffsetRef,
}: {
  readonly displayedResultsQuery: string | null
  readonly parentRef: RefObject<HTMLDivElement | null>
  readonly rootPath: string
  readonly scrollToOffsetRef: RefObject<(offset: number) => void>
}) {
  const [standaloneIncarnation] = useState(() => ({}))
  const incarnation = useSearchBufferValue(
    rootPath,
    (snapshot) => snapshot.incarnation,
    standaloneIncarnation,
  )
  const state = searchResultScrollState(incarnation)

  useLayoutEffect(() => {
    const element = parentRef.current
    if (!element) return

    return attachSearchResultScroll({
      element,
      query: displayedResultsQuery,
      scrollToOffset: scrollToOffsetRef.current,
      state,
    })
  }, [displayedResultsQuery, parentRef, scrollToOffsetRef, state])

  return state.read(displayedResultsQuery)
}
