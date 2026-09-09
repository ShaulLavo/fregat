import * as v from 'valibot'
import type { Client } from '@workspace/client-core/transport/client'
import { requireEdenData, parseEdenSseStream } from '@workspace/client-core/transport/eden'
import { normalizeEdenDates } from '@workspace/client-core/transport/normalize-dates'
import {
  logDashboardSummarySchema,
  logEventsResultSchema,
  logLiveStreamItemSchema,
  type LogDashboardSummary,
  type LogEventsResult,
  type LogDashboardFilters,
} from '@workspace/contracts'
import { connectionFailure } from '@/connection/utils/failure'
import { addLogSummary, mergeLogEvent, mergeLogSnapshot } from '@/logs/utils/events'

type State = {
  kind: 'loading' | 'ready' | 'failed'
  result: LogEventsResult
  summary: LogDashboardSummary | null
  message: string
  live: boolean
}
export function createLogsWorkbench(client: Client) {
  const listeners = new Set<() => void>()
  let controller = new AbortController()
  let disposed = false
  let state: State = {
    kind: 'loading',
    result: { events: [], detailsById: {}, total: 0, nextCursor: null },
    summary: null,
    message: '',
    live: false,
  }
  function publish(next: State) {
    if (disposed) return
    state = next
    for (const listener of listeners) listener()
  }
  async function tail(filters: LogDashboardFilters, signal: AbortSignal) {
    try {
      const stream = requireEdenData(
        await client._log.dashboard.live.get({ query: filters, fetch: { signal } }),
      )
      if (!signal.aborted) publish({ ...state, live: true })
      for await (const event of parseEdenSseStream(stream)) {
        if (signal.aborted) return
        if (event.event === 'heartbeat') continue
        const item = v.parse(logLiveStreamItemSchema, event.data)
        const duplicate = state.result.detailsById[item.event.id] !== undefined
        const summary =
          state.summary && !duplicate
            ? addLogSummary(state.summary, item.event, filters.slowMs ?? 500)
            : state.summary
        publish({ ...state, result: mergeLogEvent(state.result, item), summary })
      }
      if (!signal.aborted)
        publish({ ...state, live: false, message: 'Live connection ended. Refresh to reconnect.' })
    } catch (error) {
      if (!signal.aborted)
        publish({ ...state, live: false, message: connectionFailure(error).message })
    }
  }
  async function refresh(filters: LogDashboardFilters = {}, paused = false) {
    if (disposed) return
    controller.abort()
    controller = new AbortController()
    const signal = controller.signal
    publish({
      ...state,
      kind: 'loading',
      result: { events: [], detailsById: {}, total: 0, nextCursor: null },
      message: '',
      live: false,
    })
    if (!paused) void tail(filters, signal)
    try {
      const [eventsResponse, summaryResponse] = await Promise.all([
        client._log.dashboard.events.get({ query: { ...filters, limit: 300 }, fetch: { signal } }),
        client._log.dashboard.summary.get({ query: filters, fetch: { signal } }),
      ])
      const result = v.parse(
        logEventsResultSchema,
        normalizeEdenDates(requireEdenData(eventsResponse)),
      )
      let summary = v.parse(
        logDashboardSummarySchema,
        normalizeEdenDates(requireEdenData(summaryResponse)),
      )
      for (const event of state.result.events) {
        if (!result.detailsById[event.id])
          summary = addLogSummary(summary, event, filters.slowMs ?? 500)
      }
      if (!signal.aborted)
        publish({
          ...state,
          kind: 'ready',
          result: mergeLogSnapshot(result, state.result),
          summary,
        })
    } catch (error) {
      if (!signal.aborted)
        publish({ ...state, kind: 'failed', message: connectionFailure(error).message })
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    refresh,
    dispose() {
      disposed = true
      controller.abort()
      listeners.clear()
    },
  }
}
