import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { historyQueryOptions } from '@/features/git/utils/history-query'

export function useHistory(rootPath: string, ref: string, search: string, pageCount: number) {
  const history = useInfiniteQuery(historyQueryOptions(rootPath, ref, search))
  const isRestoring = (history.data?.pages.length ?? 0) < pageCount && history.hasNextPage
  const { fetchNextPage, isFetching, isError } = history

  useEffect(() => {
    if (isRestoring && !isFetching && !isError) void fetchNextPage()
  }, [isRestoring, isFetching, isError, fetchNextPage])

  return { ...history, isRestoring }
}
