import { Elysia } from 'elysia'
import * as v from 'valibot'

import { recordClientLog } from './client-ingest'
import { LogReaderService } from './log-reader'
import { sseResponse, toSse } from '../sse'

const logLevelQueryValueSchema = v.union([
  v.literal('debug'),
  v.literal('error'),
  v.literal('info'),
  v.literal('warn'),
])

const logDashboardQueryEntries = {
  areas: v.optional(stringListQueryValueSchema()),
  levels: v.optional(logLevelListQueryValueSchema()),
  search: v.optional(v.string()),
  since: v.optional(v.string()),
  slowMs: v.optional(integerQueryValueSchema('500', 60_000)),
  sources: v.optional(stringListQueryValueSchema()),
  until: v.optional(v.string()),
}

const logDashboardQuerySchema = v.object(logDashboardQueryEntries)

const logEventsQuerySchema = v.object({
  ...logDashboardQueryEntries,
  cursor: v.optional(v.string()),
  limit: v.optional(integerQueryValueSchema('200', 1_000)),
})

const logEventQuerySchema = v.object({
  ...logDashboardQueryEntries,
  id: v.string(),
})

const logLiveQuerySchema = v.object({
  ...logDashboardQueryEntries,
  pollIntervalMs: v.optional(integerQueryValueSchema('500', 5_000)),
})

export function observabilityRoutes(options: { logs?: LogReaderService } = {}) {
  const logs = options.logs ?? new LogReaderService()

  return new Elysia({ name: 'observability-routes' }).group('/_log', (app) =>
    app
      .post('/ingest', ({ body, request, set }) => {
        const result = recordClientLog(body, request)
        if (result.ok) {
          set.status = 204
          return null
        }

        set.status = 400
        return { error: { message: result.message } }
      })
      .group('/dashboard', (dashboard) =>
        dashboard
          .get('/summary', ({ query }) => logs.summary(query), {
            query: logDashboardQuerySchema,
          })
          .get('/events', ({ query }) => logs.events(query), {
            query: logEventsQuerySchema,
          })
          .get(
            '/event',
            async ({ query, set }) => {
              const result = await logs.event(query.id, query)
              if (result) return result

              set.status = 404
              return { error: { message: 'Log event not found.' } }
            },
            {
              query: logEventQuerySchema,
            },
          )
          .get(
            '/live',
            ({ query, request }) =>
              sseResponse(
                toSse(logs.live({ ...query, signal: request.signal }), {
                  event: (item) => item.kind,
                }),
                request.signal,
              ),
            {
              query: logLiveQuerySchema,
            },
          ),
      ),
  )
}

function stringListQueryValueSchema() {
  return v.pipe(
    v.union([v.string(), v.array(v.string())]),
    v.transform((value) => queryList(value)),
  )
}

function logLevelListQueryValueSchema() {
  return v.pipe(
    v.union([logLevelQueryValueSchema, v.array(logLevelQueryValueSchema)]),
    v.transform((value) => (Array.isArray(value) ? value : [value])),
  )
}

function queryList(value: string | string[]) {
  const values = Array.isArray(value) ? value : value.split(',')

  return values.map((item) => item.trim()).filter(Boolean)
}

function integerQueryValueSchema(fallback: string, max: number) {
  return v.pipe(
    v.optional(v.string(), fallback),
    v.transform((value) => Number.parseInt(value, 10)),
    v.integer(),
    v.minValue(1),
    v.maxValue(max),
  )
}
