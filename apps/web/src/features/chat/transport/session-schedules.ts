import type { ProviderSessionSchedules, ScopedSessionRef } from '@workspace/contracts'

import { environmentClientFor } from '@/lib/client'
import { unwrapEdenResponse } from '@/lib/eden-events'
import { confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'

export async function fetchSessionSchedules(ref: ScopedSessionRef, signal: AbortSignal) {
  const client = environmentClientFor(confirmedEnvironmentOrigin(ref.environmentId))
  const response = await client.providers
    .sessions({ sessionId: ref.sessionId })
    .schedules.get({ fetch: { signal } })
  return unwrapEdenResponse<ProviderSessionSchedules>(response, {
    emptyMessage: 'the schedule list carried no data',
    requireData: true,
  })
}
