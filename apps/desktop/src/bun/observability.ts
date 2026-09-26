import {
  flushObservability,
  initializeObservabilityRuntime,
  recordObservabilityError,
  recordObservabilityInfo,
} from '@workspace/observability'

export function initializeDesktopObservability() {
  return initializeObservabilityRuntime({
    env: Bun.env,
    source: 'desktop',
  })
}

export { flushObservability as flushDesktopObservability }

export function recordDesktopInfo(action: string, context: Record<string, unknown> = {}) {
  recordObservabilityInfo(action, desktopContext(context))
}

export function recordDesktopError(action: string, context: Record<string, unknown> = {}) {
  recordObservabilityError(action, desktopContext(context))
}

function desktopContext(context: Record<string, unknown>) {
  return {
    area: 'desktop',
    ...context,
  }
}
