import { TickerText } from '@/components/ticker-text'
import { useNavigation } from '@/hooks/use-navigation'
import { ArrowClockwiseIcon } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { useState } from 'react'

import { logsKeys } from '@/features/logs/utils/query-keys'
import { FocusablePanel } from '@/components/focusable-panel'
import { logDashboardFilters } from '@/features/logs/utils/filter-params'
import { logFilterQuery, logToolbarOptionFilters } from '@/features/logs/utils/filter-params'
import { useLogEvents } from '@/features/logs/hooks/use-events'
import { useLogSummary } from '@/features/logs/hooks/use-summary'
import { LogsEventList } from '@/features/logs/components/event-list'
import { LogsListLoading } from '@/features/logs/components/list-loading'
import { useLogLive } from '@/features/logs/hooks/use-live'
import { ToolPane } from '@workspace/ui/patterns/tool-pane'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { LogsTimeline } from '@/features/logs/components/timeline'
import { LogsToolbar } from '@/features/logs/components/toolbar'
import { useLogsFilters } from '@/features/logs/state/filter-store'
import { ToolPaneHeader } from '@/components/tool-pane-header'

type LogsPanelProps = {
  active: boolean
}

export function LogsPanel({ active }: LogsPanelProps) {
  const navigation = useNavigation()
  const queryClient = useQueryClient()

  const filtersState = useLogsFilters()
  const [inspection, setInspection] = useState<{ filters: string; id: string | null } | null>(null)
  const [now, setNow] = useState(Date.now)
  const filters = logDashboardFilters(filtersState, now)
  const queryFilters = logFilterQuery(filters)
  const filterKey = JSON.stringify(queryFilters)
  const inspectedEventId = inspection?.filters === filterKey ? inspection.id : null
  const optionFilters = logToolbarOptionFilters(filters)
  const optionQueryFilters = logFilterQuery(optionFilters)
  useLogLive(filters, active)
  const events = useLogEvents(filters, active)
  const summary = useLogSummary(filters, active)
  const optionSummary = useLogSummary(optionFilters, active)

  function handleRefresh() {
    setNow(Date.now())
    void queryClient.invalidateQueries({ queryKey: logsKeys.events(queryFilters) })
    void queryClient.invalidateQueries({ queryKey: logsKeys.summary(queryFilters) })
    void queryClient.invalidateQueries({ queryKey: logsKeys.summary(optionQueryFilters) })
  }

  return (
    <FocusablePanel
      area='logs'
      target={{ kind: 'logs' }}
      className='text-foreground flex h-full min-h-0 flex-col'
    >
      <ToolPane
        bodyClassName='flex flex-col overflow-hidden'
        state={{
          pending: events.isPending,
          error: events.isError || summary.isError,
          empty: events.data?.events.length === 0,
        }}
        loading={<LogsListLoading />}
        errorState={<EmptyState title='Could not read local logs.' tone='error' />}
        emptyState={
          <EmptyState className='flex-1 px-6' title='No logs match the current filters.' />
        }
        header={
          <>
            <ToolPaneHeader
              actions={
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        aria-label='Refresh logs'
                        className='text-muted-foreground'
                        disabled={summary.isFetching || optionSummary.isFetching}
                        focusableWhenDisabled
                        size='icon-sm'
                        type='button'
                        variant='ghost'
                        onClick={handleRefresh}
                      >
                        <ArrowClockwiseIcon className='size-(--icon-size)' />
                      </Button>
                    }
                  />
                  <TooltipContent side='bottom'>Refresh logs</TooltipContent>
                </Tooltip>
              }
              detail={summary.data ? <TickerText text={`${summary.data.total} events`} /> : null}
              tab='logs'
            />
            <LogsToolbar
              areas={optionSummary.data?.areas ?? []}
              filters={filtersState}
              sources={optionSummary.data?.sources ?? []}
              onFiltersChange={(filters) => void navigation.setLogsFilters(filters)}
            />
          </>
        }
      >
        <LogsTimeline summary={summary.data} />
        <LogsEventList
          events={events.data?.events ?? []}
          detailsById={events.data?.detailsById ?? {}}
          inspectedEventId={inspectedEventId}
          onInspectEvent={(id) => setInspection({ filters: filterKey, id })}
        />
      </ToolPane>
    </FocusablePanel>
  )
}
