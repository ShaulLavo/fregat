import type { DrainContext } from 'evlog'
import { initializeObservabilityRuntime, type ObservabilityEnv } from '@workspace/observability'

export {
  flushObservability,
  isObservabilityActive,
  observabilityConfig,
  recordObservabilityError as recordProcessError,
  recordObservabilityInfo as recordProcessInfo,
  recordObservabilityWarning as recordProcessWarning,
  resetObservabilityForTests,
} from '@workspace/observability'

export function initializeObservability(
  env: ObservabilityEnv = process.env,
  build?: { commit?: string | null; release?: string | null },
) {
  return initializeObservabilityRuntime({
    ...(build ? { build } : {}),
    env,
    shouldPersistEvent: shouldPersistServerEvent,
    source: 'be',
  })
}

function shouldPersistServerEvent(context: DrainContext) {
  if (isRoutineHealthEvent(context)) return false
  if (isRoutineClientLogIngestEvent(context)) return false
  if (isRoutineLogDashboardEvent(context)) return false

  return true
}

function isRoutineHealthEvent(context: DrainContext) {
  const event = context.event as Record<string, unknown>
  if (event.path !== '/health') return false
  if (typeof event.status !== 'number') return false

  return event.status < 400
}

function isRoutineClientLogIngestEvent(context: DrainContext) {
  const event = context.event as Record<string, unknown>
  if (event.path !== '/_log/ingest') return false
  if (typeof event.status !== 'number') return false

  return event.status < 400
}

function isRoutineLogDashboardEvent(context: DrainContext) {
  const event = context.event as Record<string, unknown>
  if (typeof event.path !== 'string') return false
  if (!event.path.startsWith('/_log/dashboard')) return false
  if (typeof event.status !== 'number') return false

  return event.status < 400
}
