import type {
  LogDashboardFilters,
  LogEventDetailsById,
  LogEventsResult,
} from '@workspace/contracts'

import { useLogLive } from '@/features/logs/hooks/use-live'
import { LogsEventList } from '@/features/logs/components/event-list'

type LogsEventListContainerProps = {
  active: boolean
  data: LogEventsResult | undefined
  filters: LogDashboardFilters
  inspectedEventId: string | null
  onInspectEvent: (eventId: string | null) => void
}

const emptyDetailsById: LogEventDetailsById = Object.freeze({})

export function LogsEventListContainer({
  active,
  data,
  filters,
  inspectedEventId,
  onInspectEvent,
}: LogsEventListContainerProps) {
  useLogLive(filters, active)

  return (
    <LogsEventList
      detailsById={data?.detailsById ?? emptyDetailsById}
      events={data?.events ?? []}
      inspectedEventId={inspectedEventId}
      onInspectEvent={onInspectEvent}
    />
  )
}
