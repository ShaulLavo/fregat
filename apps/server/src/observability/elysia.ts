import type { EnrichContext, LogLevel } from 'evlog'
import { type Elysia, NotFoundError } from 'elysia'
import { evlog } from 'evlog/elysia'
import { isRecord } from '@workspace/utils/objects'

import type { FsErrorCode } from '../fs/errors'
import { recordRequestContext } from './logging'
import { isObservabilityActive } from './runtime'

const ROUTE_NOT_FOUND: FsErrorCode = 'ROUTE_NOT_FOUND'

export function applyObservability(app: Elysia) {
  if (!isObservabilityActive()) return

  // Ahead of evlog, whose onError logs Elysia's NotFoundError under the same code as a missing file.
  app.onError({ as: 'global' }, ({ error }) => {
    if (isRouteMiss(error)) recordRequestContext({ errorCode: ROUTE_NOT_FOUND })
  })
  app.use(
    evlog({
      enrich: applyHttpStatusLevel,
      exclude: ['/_log/ingest'],
    }),
  )
}

function isRouteMiss(error: unknown) {
  if (error instanceof NotFoundError) return true

  return isRecord(error) && error.code === ROUTE_NOT_FOUND
}

// Enrich runs last on the merged event, after every `logger.error` call copied the stack in.
function applyHttpStatusLevel({ event, response }: EnrichContext) {
  const status = response?.status
  const routeMiss = event.errorCode === ROUTE_NOT_FOUND
  event.level = raiseForWarning(httpStatusLevel(status, routeMiss), event.requestLogs)
  if (status === 404 && !routeMiss && isRecord(event.error)) delete event.error.stack
}

// A `recordRequestWarning` marks a degraded answer, even one sent with a 2xx.
function raiseForWarning(level: LogLevel, requestLogs: unknown): LogLevel {
  if (level !== 'info' || !Array.isArray(requestLogs)) return level

  return requestLogs.some((log) => isRecord(log) && log.level === 'warn') ? 'warn' : level
}

/** A 404 from a handler answers the caller's lookup: `info`. A route miss is a client bug: `warn`. */
export function httpStatusLevel(status: number | undefined, routeMiss = false): LogLevel {
  if (status === undefined) return 'info'
  if (status >= 500) return 'error'
  if (status === 404 && !routeMiss) return 'info'
  if (status >= 400) return 'warn'

  return 'info'
}
