import type { IntentQueue, IntentQueueState } from '@workspace/client-core/optimistic/queue'

import { log } from '@/lib/client-logging'

/** A pending change the user has had no sign of for this long is a missing affordance. */
export const SILENT_HOLD_MS = 150
/** A pending change held this long should have escalated to a fallback. */
export const LONG_HOLD_MS = 5_000

/**
 * Watches a queue for the two holds the design rules forbid and logs each one
 * once, with the fix, so an agent reading `logs/` sees "silent hold on
 * chat.rail, 620ms, no status element" instead of nothing. Returns the queue so
 * a feature can wrap its `createIntentQueue` call.
 */
export function watchIntentHolds<TPatch>(
  queue: IntentQueue<TPatch>,
  { area, describe }: { readonly area: string; readonly describe?: (patch: TPatch) => string },
): IntentQueue<TPatch> {
  if (typeof document === 'undefined') return queue

  const timers = new Map<string, ReturnType<typeof setTimeout>[]>()
  queue.subscribe((state, previous) => {
    for (const intent of newlyPending(state, previous)) {
      const summary = describe?.(intent.patch)
      timers.set(intent.intentId, [
        globalThis.setTimeout(
          () => reportSilentHold(area, intent.intentId, summary),
          SILENT_HOLD_MS,
        ),
        globalThis.setTimeout(() => reportLongHold(area, intent.intentId, summary), LONG_HOLD_MS),
      ])
    }
    for (const intentId of noLongerPending(state, previous)) {
      for (const timer of timers.get(intentId) ?? []) globalThis.clearTimeout(timer)
      timers.delete(intentId)
    }
  })

  return queue
}

function newlyPending<TPatch>(state: IntentQueueState<TPatch>, previous: IntentQueueState<TPatch>) {
  const known = new Set(previous.active.map((intent) => intent.intentId))
  return state.active.filter((intent) => intent.status === 'pending' && !known.has(intent.intentId))
}

function noLongerPending<TPatch>(
  state: IntentQueueState<TPatch>,
  previous: IntentQueueState<TPatch>,
) {
  const pending = new Set(
    state.active.filter((intent) => intent.status === 'pending').map((intent) => intent.intentId),
  )
  return previous.active.map((intent) => intent.intentId).filter((id) => !pending.has(id))
}

function reportSilentHold(area: string, intentId: string, summary: string | undefined) {
  const statusElements = document.querySelectorAll('[role="status"], [aria-busy="true"]').length
  if (statusElements > 0) return

  log.warn({
    action: 'optimistic.silent_hold',
    area,
    intentId,
    summary,
    heldMs: SILENT_HOLD_MS,
    why: 'A change has been pending with no loader or busy marker anywhere on the page.',
    fix: 'Show a pending affordance for this action: Spinner on the control, OrbitLoader beside the row, or a projected value the user can see.',
  })
}

function reportLongHold(area: string, intentId: string, summary: string | undefined) {
  log.warn({
    action: 'optimistic.long_hold',
    area,
    intentId,
    summary,
    heldMs: LONG_HOLD_MS,
    why: 'A change has been pending past the point a small pending indicator is honest.',
    fix: 'Escalate to a fallback: a LoadingState for the region, a retry offer, or a lower acknowledgement timeout.',
  })
}
