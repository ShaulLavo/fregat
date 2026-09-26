import { use, useSyncExternalStore } from 'react'
import { EnvironmentConnectionsContext } from '@/providers/environment-connections-context'
import { requireContext } from '@/lib/require-context'

export function useEnvironmentConnections() {
  const connections = use(EnvironmentConnectionsContext)
  requireContext(connections, 'Machines require EnvironmentTransportsProvider.')
  const snapshot = useSyncExternalStore(connections.store.subscribe, connections.store.getState)
  return { ...connections, machines: snapshot.machines }
}
