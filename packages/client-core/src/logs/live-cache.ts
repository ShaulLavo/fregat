import type {
  LogEventDetailsById,
  LogEventDetail,
  LogEventSummary,
  LogEventsResult,
  LogLiveStreamItem,
} from '@workspace/contracts'

type MergeLiveLogOptions = {
  detailsById?: LogEventDetailsById
  maxEvents?: number
}

export function mergeLiveLogEvent(
  current: LogEventsResult | undefined,
  event: LogEventSummary,
  options: { detail?: LogEventDetail; maxEvents?: number } = {},
): LogEventsResult | undefined {
  const detailsById = options.detail ? { [event.id]: options.detail } : undefined

  return mergeLiveLogEvents(current, [event], {
    detailsById,
    maxEvents: options.maxEvents,
  })
}

export function mergeLiveLogItems(
  current: LogEventsResult,
  items: readonly LogLiveStreamItem[],
  maxEvents?: number,
): LogEventsResult
export function mergeLiveLogItems(
  current: LogEventsResult | undefined,
  items: readonly LogLiveStreamItem[],
  maxEvents?: number,
): LogEventsResult | undefined
export function mergeLiveLogItems(
  current: LogEventsResult | undefined,
  items: readonly LogLiveStreamItem[],
  maxEvents = 500,
): LogEventsResult | undefined {
  return mergeLiveLogEvents(
    current,
    items.map((item) => item.event),
    {
      detailsById: detailsByIdFromLiveItems(items),
      maxEvents,
    },
  )
}

export function mergeLiveLogEvents(
  current: LogEventsResult,
  events: readonly LogEventSummary[],
  options?: MergeLiveLogOptions,
): LogEventsResult
export function mergeLiveLogEvents(
  current: LogEventsResult | undefined,
  events: readonly LogEventSummary[],
  options?: MergeLiveLogOptions,
): LogEventsResult | undefined
export function mergeLiveLogEvents(
  current: LogEventsResult | undefined,
  events: readonly LogEventSummary[],
  options: MergeLiveLogOptions = {},
): LogEventsResult | undefined {
  if (!current) return current
  if (events.length === 0) return current

  const maxEvents = options.maxEvents ?? 500
  const existingIds = new Set(current.events.map((candidate) => candidate.id))
  const uniqueEvents: LogEventSummary[] = []
  for (const event of events) {
    if (existingIds.has(event.id)) continue

    existingIds.add(event.id)
    uniqueEvents.push(event)
  }
  if (uniqueEvents.length === 0) return current

  const mergedEvents = [...uniqueEvents.reverse(), ...current.events]
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, maxEvents)

  return {
    ...current,
    detailsById: mergeDetailsByRetainedEvents(
      current.detailsById ?? {},
      options.detailsById ?? {},
      mergedEvents,
    ),
    events: mergedEvents,
    total: current.total + uniqueEvents.length,
  }
}

function detailsByIdFromLiveItems(items: readonly LogLiveStreamItem[]) {
  const detailsById: Record<string, LogEventDetail> = {}

  for (const item of items) {
    detailsById[item.event.id] = item.detail
  }

  return detailsById
}

function mergeDetailsByRetainedEvents(
  current: LogEventDetailsById,
  incoming: LogEventDetailsById,
  events: readonly LogEventSummary[],
) {
  const detailsById: Record<string, LogEventDetail> = {}

  for (const event of events) {
    const detail = incoming[event.id] ?? current[event.id]
    if (!detail) continue

    detailsById[event.id] = detail
  }

  return detailsById
}
