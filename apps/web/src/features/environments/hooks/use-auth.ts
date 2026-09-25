import { use, useSyncExternalStore } from 'react'
import { EnvironmentConnectionsContext } from '@/providers/environment-connections-context'
import { requireContext } from '@/lib/require-context'

export function useAuth() {
  const connections = use(EnvironmentConnectionsContext)
  requireContext(connections, 'Machine authentication requires EnvironmentTransportsProvider.')
  const state = useSyncExternalStore(
    connections.authStore.subscribe,
    connections.authStore.getState,
  )
  return { ...state, answer: connections.answerAuth }
}
