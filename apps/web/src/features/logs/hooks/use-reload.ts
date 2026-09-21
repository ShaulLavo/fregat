import { useLogsReloadOwner } from '@/features/logs/hooks/use-reload-owner'
import { useLayoutEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { LogDashboardSummary, LogEventsResult } from '@workspace/contracts'
import { addLifecycleFlush } from '@/lib/lifecycle-flush'
import { captureLogs, savedLogs } from '@/features/logs/state/reload'

export function useLogsReload(
  filterKey: string,
  windowTime: number,
  events: LogEventsResult | undefined,
  summary: LogDashboardSummary | undefined,
  options: LogDashboardSummary | undefined,
  inspectedId: string | null,
) {
  const owner = useQueryClient()
  const target = useLogsReloadOwner()
  const saved = savedLogs(owner, filterKey, target)
  const position = useRef({ filterKey, scrollTop: saved?.scrollTop ?? 0 })
  useLayoutEffect(() => {
    if (position.current.filterKey !== filterKey)
      position.current = { filterKey, scrollTop: saved?.scrollTop ?? 0 }
  }, [filterKey, saved?.scrollTop])
  useLayoutEffect(() => {
    const previous = savedLogs(owner, filterKey, target)
    const observedEvents = events ?? previous?.events
    if (!observedEvents) return
    const capture = () =>
      captureLogs(owner, target, {
        filterKey,
        windowTime: events ? windowTime : previous!.windowTime,
        observedAt: events ? Date.now() : previous!.observedAt,
        events: observedEvents,
        summary: summary ?? previous?.summary,
        options: options ?? previous?.options,
        inspectedId,
        scrollTop: position.current.filterKey === filterKey ? position.current.scrollTop : 0,
      })
    capture()
    const remove = addLifecycleFlush(capture)
    return () => {
      capture()
      remove()
    }
  }, [owner, target, filterKey, windowTime, events, summary, options, inspectedId])
  return {
    initialOffset: saved?.scrollTop,
    onScroll: (scrollTop: number) => {
      position.current = { filterKey, scrollTop }
    },
  }
}
