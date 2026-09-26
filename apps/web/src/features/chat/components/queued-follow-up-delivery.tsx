import { lazy, Suspense } from 'react'

import { useFollowUpStore } from '@/features/chat/state/follow-up-store'

// The senders load with the first queued follow-up, never at boot.
const Senders = lazy(() =>
  import('@/features/chat/components/queued-follow-up-senders').then((module) => ({
    default: module.QueuedFollowUpSenders,
  })),
)

/** Queued follow-ups keep sending after their session is closed or another one is opened. */
export function QueuedFollowUpDelivery() {
  const queued = useFollowUpStore((state) => Object.keys(state.queues).length > 0)
  if (!queued) return null

  return (
    <Suspense fallback={null}>
      <Senders />
    </Suspense>
  )
}
