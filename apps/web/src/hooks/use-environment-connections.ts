import { use } from 'react'
import { useStore } from 'zustand'
import { EnvironmentConnectionsContext } from '@/providers/environment-connections-context'
import { requireContext } from '@/lib/require-context'

export function useEnvironmentConnections() {
  const connections = use(EnvironmentConnectionsContext)
  requireContext(connections, 'Machines require EnvironmentTransportsProvider.')
  const machines = useStore(connections.store, (state) => state.machines)
  return { ...connections, machines }
}
