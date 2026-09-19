import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { historyQueryOptions } from '@/features/git/utils/history-query'

export function useHistory(rootPath: string, ref: string, search: string, pageCount: number) {
  const history = useInfiniteQuery(historyQueryOptions(rootPath, ref, search))
  const [shownSearch, setShownSearch] = useState(search)
  const ownsRows = !history.isPending && !history.isPlaceholderData
  // The search the rows on screen answer, which trails `search` while a new one is in flight.
  if (ownsRows && shownSearch !== search) setShownSearch(search)
  const isRestoring =
    ownsRows && (history.data?.pages.length ?? 0) < pageCount && history.hasNextPage
  const { fetchNextPage, isFetching, isError } = history

  useEffect(() => {
    if (isRestoring && !isFetching && !isError) void fetchNextPage()
  }, [isRestoring, isFetching, isError, fetchNextPage])

  return { ...history, isRestoring, shownSearch: ownsRows ? search : shownSearch }
}
