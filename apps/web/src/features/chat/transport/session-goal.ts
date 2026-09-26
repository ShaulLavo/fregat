import type {
  ProviderGoalAction,
  ProviderSessionGoalState,
  ScopedSessionRef,
} from '@workspace/contracts'

import { environmentClientFor } from '@/lib/client'
import { unwrapEdenResponse } from '@/lib/eden-events'
import { confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'

function sessionGoal(ref: ScopedSessionRef) {
  const client = environmentClientFor(confirmedEnvironmentOrigin(ref.environmentId))
  return client.providers.sessions({ sessionId: ref.sessionId }).goal
}

export async function fetchSessionGoal(ref: ScopedSessionRef, signal: AbortSignal) {
  const response = await sessionGoal(ref).get({ fetch: { signal } })
  return unwrapEdenResponse<ProviderSessionGoalState>(response, {
    emptyMessage: 'the goal read carried no data',
    requireData: true,
  })
}

/** Resolves with the goal after the change, so the indicator settles without a second read. */
export async function controlSessionGoal(ref: ScopedSessionRef, action: ProviderGoalAction) {
  const response = await sessionGoal(ref).post({ action })
  return unwrapEdenResponse<ProviderSessionGoalState>(response, {
    emptyMessage: 'the goal change carried no data',
    requireData: true,
  })
}
