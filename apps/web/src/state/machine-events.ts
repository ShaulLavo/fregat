import type { MachineEvent } from '@workspace/contracts'
import { subscribeMachineEvents } from '@/lib/environments/machine-client'
import { createEnvironmentRecovery } from '@/state/environment-recovery'
import { createWideEventScope } from '@/lib/wide-event-scope'

export function startMachineEvents(receive: (event: MachineEvent) => void) {
  let subscription: AbortController | null = null
  let stopped = false
  const recovery = createEnvironmentRecovery(subscribe)

  async function subscribe() {
    if (stopped || subscription) return
    const abort = new AbortController()
    subscription = abort
    const event = createWideEventScope({ action: 'machine.events', area: 'environments' })
    try {
      for await (const update of subscribeMachineEvents(abort.signal)) {
        if (abort.signal.aborted) return
        recovery.forget('events')
        receive(update)
      }
    } catch (error) {
      if (!abort.signal.aborted) event.error(error)
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
