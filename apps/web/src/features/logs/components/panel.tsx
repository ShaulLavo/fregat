import { useNavigation } from '@/hooks/use-navigation'
import { ArrowClockwiseIcon } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'

import { logsKeys } from '@/features/logs/utils/query-keys'
import { FocusablePanel } from '@/components/focusable-panel'
import { logDashboardFilters } from '@/features/logs/utils/filter-params'
import { logFilterQuery, logToolbarOptionFilters } from '@/features/logs/utils/filter-params'
import { useLogEvents } from '@/features/logs/hooks/use-events'
import { useLogSummary } from '@/features/logs/hooks/use-summary'
import { LogsEventListContainer } from '@/features/logs/components/event-list-container'
import { LogsTimeline } from '@/features/logs/components/timeline'
import { LogsToolbar } from '@/features/logs/components/toolbar'
import { useLogsFilters } from '@/features/logs/state/filter-store'
import { ToolPaneHeader } from '@/features/workbench/components/tool-pane-header'

type LogsPanelProps = {
  active: boolean
}

export const LogsPanel = memo(({ active }: LogsPanelProps) => {
  const navigation = useNavigation()
  const queryClient = useQueryClient()

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
    <FocusablePanel
      area='logs'
      target={{ kind: 'logs' }}
      className='text-foreground flex h-full min-h-0 flex-col'
    >
      <ToolPaneHeader
        actions={
          <Button
            aria-label='Refresh logs'
            className='text-muted-foreground'
            disabled={summary.isFetching || optionSummary.isFetching}
            size='icon-sm'
            title='Refresh logs'
            type='button'
            variant='ghost'
            onClick={handleRefresh}
          >
            <ArrowClockwiseIcon className='size-3.5' />
          </Button>
        }
        detail={summary.data ? `${summary.data.total} events` : null}
        tab='logs'
      />
      <LogsToolbar
        areas={optionSummary.data?.areas ?? []}
        filters={filtersState}
        sources={optionSummary.data?.sources ?? []}
        onFiltersChange={(filters) => void navigation.setLogsFilters(filters)}
      />
      <LogsTimeline summary={summary.data} />
      {summary.isError || events.isError ? (
        <div className='bg-destructive/10 text-destructive border-b px-(--density-control-padding-x) py-(--density-section-gap) text-xs'>
          Could not read local logs.
        </div>
      ) : null}
      <LogsEventListContainer
        active={active}
        data={events.data}
        filters={filters}
        inspectedEventId={inspectedEventId}
        pending={events.isPending}
        onInspectEvent={handleInspectEvent}
      />
    </FocusablePanel>
  )
})
