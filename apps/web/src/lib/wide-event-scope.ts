import { clientInstanceId } from '@/lib/instance-id'
import { eventLogContext } from '@/lib/environments/state/log-context'
import {
  createWideEventScope as createScope,
  type WideEventBase,
  type WideEventScope,
} from '@workspace/observability/scope'

import { clientLoggingEnabled, log } from '@/lib/client-logging'

type FailureLevel = 'warn' | 'error'
type HeldFailure = { level: FailureLevel; readonly timer: ReturnType<typeof setTimeout> }

/** A failed scope that ends within this is one line; one still open is checkpointed then. */
export const FAILURE_CHECKPOINT_GRACE_MS = 5_000

let scopeSequence = 0
let watchingPageHide = false
const heldFailures = new Map<WideEventScope, HeldFailure>()

export function createWideEventScope(base: WideEventBase): WideEventScope {
  const enabled = clientLoggingEnabled()
  if (!enabled) return createScope({ enabled: false, base })
  const scope = createScope({
    enabled,
    base: {
      ...eventLogContext(base),
      ...base,
      runtime: 'browser',
      scopeId:
        globalThis.crypto?.randomUUID?.() ?? `${clientInstanceId()}:scope:${++scopeSequence}`,
    },
    onFailure: (level) => holdFailure(scope, level),
  })
  return {
    ...scope,
    end(overrides) {
      releaseFailure(scope)
      scope.end(overrides)
    },
  }
}

function holdFailure(scope: WideEventScope, level: FailureLevel): void {
  const held = heldFailures.get(scope)
  if (held) {
    if (level === 'error') held.level = 'error'
    return
  }

  const timer = setTimeout(() => checkpointFailure(scope), FAILURE_CHECKPOINT_GRACE_MS)
  heldFailures.set(scope, { level, timer })
  watchPageHide()
}

function releaseFailure(scope: WideEventScope): HeldFailure | undefined {
  const held = heldFailures.get(scope)
  if (!held) return undefined

  clearTimeout(held.timer)
  heldFailures.delete(scope)
  return held
}

function checkpointFailure(scope: WideEventScope): void {
  const held = releaseFailure(scope)
  if (!held) return

  log[held.level](() => ({ ...scope.getContext(), checkpoint: 'failure' }))
}

function watchPageHide(): void {
  if (watchingPageHide || typeof window === 'undefined') return

  watchingPageHide = true
  // Capture on window runs before the HTTP drain's document listener flushes the batch.
  window.addEventListener('visibilitychange', checkpointOnHide, { capture: true })
}

/** A hide may be the page's last moment: checkpoint the failures still held. */
function checkpointOnHide(): void {
  if (document.visibilityState !== 'hidden') return

  for (const scope of heldFailures.keys()) checkpointFailure(scope)
}
