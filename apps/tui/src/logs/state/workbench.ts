import { createObservableStore } from '@/host/state/observable-store'
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
  let controller = new AbortController()

  const store = createObservableStore<State>({
    kind: 'loading',
    result: { events: [], detailsById: {}, total: 0, nextCursor: null },
    summary: null,
    message: '',
    live: false,
  })
  const publish = store.replace
  async function tail(filters: LogDashboardFilters, signal: AbortSignal) {
    try {
      for await (const item of subscribeLogEvents(filters, signal, client, () => {
        if (!signal.aborted) publish({ ...store.value, live: true })
      })) {
        if (signal.aborted) return
        const result = mergeLiveLogItems(store.value.result, [item])
        const duplicate = result === store.value.result
        const summary =
          store.value.summary && !duplicate
            ? addLogSummary(store.value.summary, item.event, filters.slowMs ?? 500)
            : store.value.summary
        publish({ ...store.value, result, summary, live: true })
      }
      if (!signal.aborted)
        publish({
          ...store.value,
          live: false,
          message: 'Live connection ended. Refresh to reconnect.',
        })
    } catch (error) {
      if (!signal.aborted)
        publish({ ...store.value, live: false, message: connectionFailure(error).message })
    }
  }
  async function refresh(filters: LogDashboardFilters = {}, paused = false) {
    if (store.disposed) return
    controller.abort()
    controller = new AbortController()
    const signal = controller.signal
    publish({
      ...store.value,
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
      for (const event of store.value.result.events) {
        if (!snapshotIds.has(event.id))
          summary = addLogSummary(summary, event, filters.slowMs ?? 500)
      }
      if (!signal.aborted)
        publish({
          ...store.value,
          kind: 'ready',
          result: mergeLiveLogEvents(result, store.value.result.events, {
            detailsById: store.value.result.detailsById,
          }),
          summary,
        })
    } catch (error) {
      if (!signal.aborted)
        publish({ ...store.value, kind: 'failed', message: connectionFailure(error).message })
    }
  }
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    refresh,
    dispose() {
      store.dispose()
      controller.abort()
    },
  }
}
