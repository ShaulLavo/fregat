import * as v from 'valibot'
import { startPageSubscription } from '@/lib/state/page-subscription'
import type { MachineEvent } from '@workspace/contracts'
import type { WideEventScope } from '@workspace/observability/scope'
import { subscribeMachineEvents } from '@/lib/environments/machine-client'
import { log } from '@/lib/client-logging'
import {
  isBlockedStreamError,
  STREAM_RECONNECT_DELAYS_MS,
} from '@/features/chat/utils/stream-reconnect'
import { createEnvironmentRecovery } from '@/state/environment-recovery'
import { createWideEventScope } from '@/lib/wide-event-scope'

// A restart drops the stream for seconds, so that series warns once and logs its count on reconnect.
// A series that outlasts the reconnect ladder, or a failure no retry fixes, is an error.
const GIVE_UP_FAILURES = STREAM_RECONNECT_DELAYS_MS.length

export function startMachineEvents(receive: (event: MachineEvent) => void) {
  return startPageSubscription(() => subscribeMachineEventUpdates(receive))
}

function subscribeMachineEventUpdates(receive: (event: MachineEvent) => void) {
  let subscription: AbortController | null = null
  let stopped = false
  let failures = 0
  const recovery = createEnvironmentRecovery(subscribe)

  function reconnected() {
    if (failures === 0) return
    const count = failures
    failures = 0
    log.info(() => ({
      action: 'machine.events.reconnected',
      area: 'environments',
      failures: count,
    }))
  }

  function failed(event: WideEventScope, error: unknown) {
    failures += 1
    if (!isTransientFailure(error) || failures === GIVE_UP_FAILURES) {
      event.error(error, { failures })
      return
    }
    if (failures === 1) event.warn('Machine events stream dropped; reconnecting.', { error })
    event.set({ failures })
  }

  async function subscribe() {
    if (stopped || subscription) return
    const abort = new AbortController()
    subscription = abort
    const event = createWideEventScope({ action: 'machine.events', area: 'environments' })
    try {
      for await (const update of subscribeMachineEvents(abort.signal)) {
        if (abort.signal.aborted) return
        recovery.forget('events')
        reconnected()
        receive(update)
      }
    } catch (error) {
      if (!abort.signal.aborted) failed(event, error)
    } finally {
      subscription = null
      event.end({ cancelled: abort.signal.aborted })
      if (!stopped) recovery.schedule('events')
    }
  }

  void subscribe()
  return () => {
    stopped = true
    subscription?.abort()
    recovery.dispose()
  }
}

function isTransientFailure(error: unknown) {
  return !isBlockedStreamError(error) && !v.isValiError(error)
}
