import path from 'node:path'
import {
  flushObservability,
  initializeObservabilityRuntime,
  recordObservabilityError,
  recordObservabilityInfo,
  recordObservabilityWarning,
} from '@workspace/observability'

export function initializeDesktopObservability(installation?: {
  stateHome: string
  releaseRoot?: string
}) {
  // Before the release root is known, installed launcher logs live under the state home.
  const env = installation
    ? {
        ...Bun.env,
        NODE_ENV: 'production',
        OBSERVABILITY_DIR: path.join(installation.releaseRoot ?? installation.stateHome, 'logs'),
      }
    : Bun.env
  return initializeObservabilityRuntime({
    env,
    source: 'desktop',
    filePrefix: installation ? 'desktop-' : undefined,
  })
}

export { flushObservability as flushDesktopObservability }

export function recordDesktopInfo(action: string, context: Record<string, unknown> = {}) {
  recordObservabilityInfo(action, desktopContext(context))
}

export function recordDesktopWarning(action: string, context: Record<string, unknown> = {}) {
  recordObservabilityWarning(action, desktopContext(context))
}

export function recordDesktopError(action: string, context: Record<string, unknown> = {}) {
  recordObservabilityError(action, desktopContext(context))
}

function desktopContext(context: Record<string, unknown>) {
  return {
    area: 'desktop',
    ...context,
    source: 'desktop',
  }
}
