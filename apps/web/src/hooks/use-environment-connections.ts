import { use, useSyncExternalStore } from 'react'
import { EnvironmentConnectionsContext } from '@/providers/environment-connections-context'
import { clientErrors } from '@/lib/structured-errors'

export function useEnvironmentConnections() {
  const connections = use(EnvironmentConnectionsContext)
  if (!connections)
    throw clientErrors.CONTEXT_MISSING({
      message: 'Machines require EnvironmentTransportsProvider.',
    })
  const snapshot = useSyncExternalStore(connections.store.subscribe, connections.store.getState)
  return { ...connections, machines: snapshot.machines }
}
