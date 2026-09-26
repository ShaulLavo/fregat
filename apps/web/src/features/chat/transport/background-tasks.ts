import type { ProviderBackgroundTasks, ScopedSessionRef } from '@workspace/contracts'

import { environmentClientFor } from '@/lib/client'
import { unwrapEdenResponse } from '@/lib/eden-events'
import { confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'

function sessionTasks(ref: ScopedSessionRef) {
  const client = environmentClientFor(confirmedEnvironmentOrigin(ref.environmentId))
  return client.providers.sessions({ sessionId: ref.sessionId })['background-tasks']
}

export async function fetchBackgroundTasks(ref: ScopedSessionRef, signal: AbortSignal) {
  const response = await sessionTasks(ref).get({ fetch: { signal } })
  return unwrapEdenResponse<ProviderBackgroundTasks>(response, {
    emptyMessage: 'the background task list carried no data',
    requireData: true,
  })
}

/** Resolves with the roster after the stop, so the list settles without a second read. */
export async function stopBackgroundTask(ref: ScopedSessionRef, taskId: string) {
  const response = await sessionTasks(ref)({ taskId }).stop.post()
  return unwrapEdenResponse<ProviderBackgroundTasks>(response, {
    emptyMessage: 'the stop response carried no task list',
    requireData: true,
  })
}
