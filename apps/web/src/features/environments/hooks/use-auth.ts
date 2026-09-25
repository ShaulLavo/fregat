import { use, useSyncExternalStore } from 'react'
import { EnvironmentConnectionsContext } from '@/providers/environment-connections-context'
import { clientErrors } from '@/lib/structured-errors'

export function useAuth() {
  const connections = use(EnvironmentConnectionsContext)
  if (!connections)
    throw clientErrors.CONTEXT_MISSING({
      message: 'Machine authentication requires EnvironmentTransportsProvider.',
    })
  const state = useSyncExternalStore(
    connections.authStore.subscribe,
    connections.authStore.getState,
  )
  return { ...state, answer: connections.answerAuth }
}
