import { useLayoutEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { addLifecycleFlush } from '@/lib/lifecycle-flush'
import { captureLogsView, savedLogsView } from '@/features/logs/state/view-reload'

export function useLogsViewReload(
  filterKey: string,
  windowTime: number,
  inspectedId: string | null,
) {
  const owner = useQueryClient()
  const saved = savedLogsView(owner, filterKey)
  const position = useRef({ filterKey, scrollTop: saved?.scrollTop ?? 0 })
  useLayoutEffect(() => {
    if (position.current.filterKey !== filterKey) position.current = { filterKey, scrollTop: 0 }
  }, [filterKey])
  useLayoutEffect(() => {
    const flush = () =>
      captureLogsView(owner, {
        filterKey,
        windowTime,
        inspectedId,
        scrollTop: position.current.filterKey === filterKey ? position.current.scrollTop : 0,
      })
    const remove = addLifecycleFlush(flush)
    return () => {
      flush()
      remove()
    }
  }, [owner, filterKey, windowTime, inspectedId])

  return {
    initialOffset: saved?.scrollTop,
    onScroll: (scrollTop: number) => {
      position.current = { filterKey, scrollTop }
    },
  }
}
