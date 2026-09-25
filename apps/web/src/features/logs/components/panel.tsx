import { TickerText } from '@/components/ticker-text'
import { useNavigation } from '@/hooks/use-navigation'
import { ArrowClockwiseIcon } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { useState } from 'react'

import { logsKeys } from '@/features/logs/utils/query-keys'
import { FocusablePanel } from '@/components/focusable-panel'
import { logDashboardFilters, logsFilterIdentity } from '@/features/logs/utils/filter-params'
import { logFilterQuery, logToolbarOptionFilters } from '@/features/logs/utils/filter-params'
import { useLogEvents } from '@/features/logs/hooks/use-events'
import { useLogSummary } from '@/features/logs/hooks/use-summary'
import { LogsEventList } from '@/features/logs/components/event-list'
import { useLogsViewReload } from '@/features/logs/hooks/use-view-reload'
import { savedLogsWindow, savedLogsView } from '@/features/logs/state/view-reload'
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
  const displayKey = logsFilterIdentity(filtersState)
  const [inspection, setInspection] = useState<{ filters: string; id: string | null } | null>(
    () => {
      const saved = savedLogsView(queryClient, displayKey)
      return saved ? { filters: displayKey, id: saved.inspectedId } : null
    },
  )
  const [now, setNow] = useState(() => savedLogsWindow(queryClient)?.windowTime ?? Date.now())
  const filters = logDashboardFilters(filtersState, now)
  const queryFilters = logFilterQuery(filters)
  const filterKey = displayKey
  const inspectedEventId = inspection?.filters === filterKey ? inspection.id : null
  const optionFilters = logToolbarOptionFilters(filters)
  const optionQueryFilters = logFilterQuery(optionFilters)
  useLogLive(filters, active)
  const events = useLogEvents(filters, active)
  const summary = useLogSummary(filters, active)
  const optionSummary = useLogSummary(optionFilters, active)

  const displayEvents = events.data
  const displaySummary = summary.data
  const displayOptions = optionSummary.data
  const reload = useLogsViewReload(displayKey, now, inspectedEventId)

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
        bodyClassName='flex flex-col'
        scroll={false}
        state={{
          pending: events.isPending,
          error: events.isError || summary.isError,
          empty: displayEvents?.events.length === 0,
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
              detail={
                displaySummary ? <TickerText text={`${displaySummary.total} events`} /> : null
              }
              tab='logs'
            />
            <LogsToolbar
              areas={displayOptions?.areas ?? []}
              filters={filtersState}
              sources={displayOptions?.sources ?? []}
              onFiltersChange={(filters) => void navigation.setLogsFilters(filters)}
            />
          </>
        }
      >
        <LogsTimeline summary={displaySummary} />
        <LogsEventList
          events={displayEvents?.events ?? []}
          initialOffset={reload.initialOffset}
          onScroll={reload.onScroll}
          detailsById={displayEvents?.detailsById ?? {}}
          inspectedEventId={inspectedEventId}
          onInspectEvent={(id) => setInspection({ filters: filterKey, id })}
        />
      </ToolPane>
    </FocusablePanel>
  )
}
