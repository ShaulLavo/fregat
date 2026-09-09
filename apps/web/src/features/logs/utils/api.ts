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

import { getClient, type Client } from '@/lib/client'
import { parseEdenSseStream } from '@workspace/client-core/transport/eden'
import { unwrapEdenResponse } from '@/lib/eden-events'
import { clientErrors, createRpcError } from '@/lib/structured-errors'
import { logFilterQuery } from '@/features/logs/utils/filter-params'

export async function fetchLogSummary(
  filters: LogDashboardFilters,
  signal?: AbortSignal,
  client: Client = getClient(),
): Promise<LogDashboardSummary> {
  const response = await client._log.dashboard.summary.get({
    fetch: { signal },
    query: logFilterQuery(filters),
  })

  return v.parse(logDashboardSummarySchema, unwrapEdenResponse(response, { normalizeDates: true }))
}

export async function fetchLogEvents(
  filters: LogDashboardFilters,
  signal?: AbortSignal,
  client: Client = getClient(),
): Promise<LogEventsResult> {
  const response = await client._log.dashboard.events.get({
    fetch: { signal },
    query: {
      ...logFilterQuery(filters),
      limit: 300,
    },
  })

  return v.parse(logEventsResultSchema, unwrapEdenResponse(response, { normalizeDates: true }))
}

export async function* subscribeLogEvents(
  filters: LogDashboardFilters,
  signal?: AbortSignal,
  client: Client = getClient(),
): AsyncGenerator<LogLiveStreamItem> {
  const response = await client._log.dashboard.live.get({
    fetch: { signal },
    query: logFilterQuery(filters),
  })
  if (response.error) throw createRpcError(response.error)
  if (!response.data) throw clientErrors.EDEN_STREAM_MISSING({ label: 'Logs stream' })

  for await (const event of parseEdenSseStream(response.data)) {
    if (event.event === 'heartbeat') continue

    yield v.parse(logLiveStreamItemSchema, event.data)
  }
}
