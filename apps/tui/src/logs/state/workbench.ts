import type { Client } from '@workspace/client-core/transport/client'
import {
  fetchLogEvents,
  fetchLogSummary,
  subscribeLogEvents,
} from '@workspace/client-core/logs/api'
import { mergeLiveLogItems, mergeLiveLogEvents } from '@workspace/client-core/logs/live-cache'
import type {
  LogDashboardSummary,
  LogEventsResult,
  LogDashboardFilters,
} from '@workspace/contracts'
import { connectionFailure } from '@/connection/utils/failure'
import { addLogSummary } from '@/logs/utils/events'

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
      for await (const item of subscribeLogEvents(filters, signal, client, () => {
        if (!signal.aborted) publish({ ...state, live: true })
      })) {
        if (signal.aborted) return
        const result = mergeLiveLogItems(state.result, [item])
        const duplicate = result === state.result
        const summary =
          state.summary && !duplicate
            ? addLogSummary(state.summary, item.event, filters.slowMs ?? 500)
            : state.summary
        publish({ ...state, result, summary, live: true })
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
      const [result, snapshotSummary] = await Promise.all([
        fetchLogEvents(filters, signal, client),
        fetchLogSummary(filters, signal, client),
      ])
      if (signal.aborted) return
      let summary = snapshotSummary
      const snapshotIds = new Set(result.events.map((event) => event.id))
      for (const event of state.result.events) {
        if (!snapshotIds.has(event.id))
          summary = addLogSummary(summary, event, filters.slowMs ?? 500)
      }
      if (!signal.aborted)
        publish({
          ...state,
          kind: 'ready',
          result: mergeLiveLogEvents(result, state.result.events, {
            detailsById: state.result.detailsById,
          }),
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
