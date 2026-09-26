import {
  logEventsResultSchema,
  logDashboardSummarySchema,
  logLiveStreamItemSchema,
  type LogDashboardFilters,
  type LogEventsResult,
  type LogDashboardSummary,
  type LogLiveStreamItem,
} from '@workspace/contracts'
import * as v from 'valibot'

import type { Client } from '../transport/client'
import { parseEdenSseStream, requireEdenData } from '../transport/eden'
import { normalizeEdenDates } from '../transport/normalize-dates'
import { transportErrors } from '../transport/structured-errors'
import { createRpcError } from '../transport/rpc-error'
import { logFilterQuery } from './filters'

export async function fetchLogSummary(
  filters: LogDashboardFilters,
  signal: AbortSignal | undefined,
  client: Client,
): Promise<LogDashboardSummary> {
  const response = await client._log.dashboard.summary.get({
    fetch: { signal },
    query: logFilterQuery(filters),
  })

  return v.parse(logDashboardSummarySchema, normalizeEdenDates(requireEdenData(response)))
}

export async function fetchLogEvents(
  filters: LogDashboardFilters,
  signal: AbortSignal | undefined,
  client: Client,
): Promise<LogEventsResult> {
  const response = await client._log.dashboard.events.get({
    fetch: { signal },
    query: {
      ...logFilterQuery(filters),
      limit: 300,
    },
  })

  return v.parse(logEventsResultSchema, normalizeEdenDates(requireEdenData(response)))
}

export async function* subscribeLogEvents(
  filters: LogDashboardFilters,
  signal: AbortSignal | undefined,
  client: Client,
  onConnected?: () => void,
): AsyncGenerator<LogLiveStreamItem> {
  const response = await client._log.dashboard.live.get({
    fetch: { signal },
    query: logFilterQuery(filters),
  })
  if (response.error) throw createRpcError(response.error)
  if (!response.data)
    throw transportErrors.EDEN_STREAM_MISSING({
      label: 'Logs stream',
      internal: { filterKeys: Object.keys(logFilterQuery(filters)) },
    })

  onConnected?.()
  for await (const event of parseEdenSseStream(response.data)) {
    if (event.event === 'heartbeat') continue

    yield v.parse(logLiveStreamItemSchema, event.data)
  }
}
