import { useNavigation } from '@/hooks/use-navigation'
import { useQueryClient } from '@tanstack/react-query'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { logsKeys } from '@/lib/query-keys'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'
import { logDashboardFilters } from '@/features/logs/utils/filter-params'
import { logFilterQuery, logToolbarOptionFilters } from '@/features/logs/utils/filter-params'
import { useLogEvents } from '@/features/logs/hooks/use-events'
import { useLogSummary } from '@/features/logs/hooks/use-summary'
import { LogsEventListContainer } from '@/features/logs/components/event-list-container'
import { LogsTimeline } from '@/features/logs/components/timeline'
import { LogsToolbar } from '@/features/logs/components/toolbar'
import { useLogsFilters } from '@/features/logs/state/filter-store'

type LogsPanelProps = {
  active: boolean
}

export const LogsPanel = memo(({ active }: LogsPanelProps) => {
  const navigation = useNavigation()
  const queryClient = useQueryClient()
  const rootRef = useRef<HTMLElement | null>(null)
  const { ref: focusTargetRef } = useFocusTarget<HTMLElement>({
    area: 'logs',
    id: { kind: 'logs' },
    onIntent: (intent) => {
      if (intent !== 'focus') return false
      if (!rootRef.current) return false

      rootRef.current.focus()
      return true
    },
  })
  // Stable identity keeps the target registration mounted across renders.
  const setRootRef = useCallback(
    (element: HTMLElement | null) => {
      rootRef.current = element
      focusTargetRef(element)
    },
    [focusTargetRef],
  )
  const filtersState = useLogsFilters()
  const [inspectedEventId, setInspectedEventId] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now)
  const filters = useMemo(() => logDashboardFilters(filtersState, now), [filtersState, now])
  const queryFilters = useMemo(() => logFilterQuery(filters), [filters])
  const optionFilters = useMemo(() => logToolbarOptionFilters(filters), [filters])
  const optionQueryFilters = useMemo(() => logFilterQuery(optionFilters), [optionFilters])
  const events = useLogEvents(filters, active)
  const summary = useLogSummary(filters, active)
  const optionSummary = useLogSummary(optionFilters, active)

  useEffect(() => {
    setInspectedEventId(null)
  }, [queryFilters])

  function handleRefresh() {
    setNow(Date.now())
    void queryClient.invalidateQueries({ queryKey: logsKeys.events(queryFilters) })
    void queryClient.invalidateQueries({ queryKey: logsKeys.summary(queryFilters) })
    void queryClient.invalidateQueries({ queryKey: logsKeys.summary(optionQueryFilters) })
  }

  const handleInspectEvent = useCallback((eventId: string | null) => {
    setInspectedEventId(eventId)
  }, [])

  return (
    <section
      className='text-foreground flex h-full min-h-0 flex-col'
      ref={setRootRef}
      tabIndex={-1}
    >
      <LogsToolbar
        areas={optionSummary.data?.areas ?? []}
        filters={filtersState}
        refreshing={summary.isFetching || optionSummary.isFetching}
        sources={optionSummary.data?.sources ?? []}
        onFiltersChange={(filters) => void navigation.setLogsFilters(filters)}
        onRefresh={handleRefresh}
      />
      <LogsTimeline summary={summary.data} />
      {summary.isError || events.isError ? (
        <div className='bg-destructive/10 text-destructive compact:px-2 compact:py-1.5 border-b px-3 py-2 text-xs'>
          Could not read local logs.
        </div>
      ) : null}
      <LogsEventListContainer
        active={active}
        data={events.data}
        filters={filters}
        inspectedEventId={inspectedEventId}
        onInspectEvent={handleInspectEvent}
      />
    </section>
  )
})
