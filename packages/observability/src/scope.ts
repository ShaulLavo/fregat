import { isRecord } from '@workspace/utils/objects'
import { createRequestLogger, type RequestLogger } from 'evlog'

import { limitDiagnosticString, sanitizeRecord } from './sanitize'

export type WideEventBase = {
  readonly action: string
  readonly area: string
  readonly [key: string]: unknown
}

// One event accumulates diagnostics until the operation or connection ends.
export type WideEventScope = {
  /** Merge context into the wide event (objects deep-merge, arrays concatenate). */
  set: (context: Record<string, unknown>) => void
  /** Increment a numeric counter at a dotted path, e.g. `plugin.activatedCount`. */
  increment: (path: string, by?: number) => void
  /** Read a numeric counter at a dotted path. */
  count: (path: string) => number
  /** Fold a warning into the wide event without emitting a separate log. */
  warn: (message: string, context?: Record<string, unknown>) => void
  /** Fold an error into the wide event without emitting a separate log. */
  error: (error: unknown, context?: Record<string, unknown>) => void
  /** Read the current accumulated context. */
  getContext: () => Record<string, unknown>
  /** Emit the accumulated wide event once. Further calls are no-ops. */
  end: (overrides?: Record<string, unknown>) => void
}

const noopScope: WideEventScope = {
  set: () => {},
  increment: () => {},
  count: () => 0,
  warn: () => {},
  error: () => {},
  getContext: () => ({}),
  end: () => {},
}

export function createWideEventScope({
  enabled,
  base,
  onFailure,
}: {
  readonly enabled: boolean
  readonly base: WideEventBase
  readonly onFailure?: (level: 'warn' | 'error', context: Record<string, unknown>) => void
}): WideEventScope {
  if (!enabled) return noopScope

  let logger: RequestLogger | null
  try {
    logger = createRequestLogger()
    logger.set(sanitizeRecord(base))
    boundScopeCollections(logger.getContext())
  } catch {
    return noopScope
  }

  let ended = false
  let warningCount = 0

  return {
    set(context) {
      if (ended || !logger) return

      guard(() => {
        logger?.set(sanitizeRecord(context))
        boundScopeCollections(logger?.getContext())
      })
    },
    increment(path, by = 1) {
      if (ended || !logger) return

      guard(() => {
        const current = numberAtPath(logger?.getContext(), path)
        logger?.set(nestedValue(path, current + by))
      })
    },
    count(path) {
      if (!logger) return 0

      return numberAtPath(logger.getContext(), path)
    },
    warn(message, context) {
      if (ended || !logger) return

      guard(() => {
        warningCount += 1
        logger?.warn(limitDiagnosticString(message), context ? sanitizeRecord(context) : undefined)
        logger?.set({ warningCount })
        boundScopeCollections(logger?.getContext())
        onFailure?.('warn', logger?.getContext() ?? {})
      })
    },
    error(error, context) {
      if (ended || !logger) return

      guard(() => {
        logger?.error(toError(error), context ? sanitizeRecord(context) : undefined)
        boundScopeCollections(logger?.getContext())
        onFailure?.('error', logger?.getContext() ?? {})
      })
    },
    getContext() {
      if (!logger) return {}

      return logger.getContext()
    },
    end(overrides) {
      if (ended || !logger) return

      ended = true
      guard(() => logger?.emit(overrides ? sanitizeRecord(overrides) : undefined))
    },
  }
}

function guard(run: () => void) {
  try {
    run()
  } catch {
    // Logging must never affect user-facing app flows.
  }
}

function toError(error: unknown): Error | string {
  if (error instanceof Error) return error

  return String(error)
}

function nestedValue(path: string, value: unknown): Record<string, unknown> {
  const keys = path.split('.')
  let nested: unknown = value
  let result: Record<string, unknown> = {}
  for (const key of keys.reverse()) {
    result = { [key]: nested }
    nested = result
  }
  return result
}

function numberAtPath(context: Record<string, unknown> | undefined, path: string): number {
  let current: unknown = context
  for (const key of path.split('.')) {
    if (!isRecord(current)) return 0
    current = current[key]
  }

  return typeof current === 'number' && Number.isFinite(current) ? current : 0
}

// evlog returns a shallow context snapshot; its nested collections remain scope-owned.
function boundScopeCollections(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    if (value.length > 25) value.splice(0, value.length - 25)
    for (const item of value) boundScopeCollections(item, seen)
    return
  }
  if (!isRecord(value)) return
  for (const [key, item] of Object.entries(value)) {
    // evlog's error cause/data can still reference application-owned objects.
    if (key === 'error') continue
    boundScopeCollections(item, seen)
  }
}
