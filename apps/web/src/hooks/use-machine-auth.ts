import { use, useSyncExternalStore } from 'react'
import { EnvironmentConnectionsContext } from '@/providers/environment-connections-context'
import { createClientInvariantError } from '@/lib/structured-errors'

export function useMachineAuth() {
  const connections = use(EnvironmentConnectionsContext)
  if (!connections)
    throw createClientInvariantError(
      'Machine authentication requires EnvironmentTransportsProvider.',
    )
  const state = useSyncExternalStore(
    connections.authStore.subscribe,
    connections.authStore.getState,
  )
  return { ...state, answer: connections.answerAuth }
}
