import { use } from 'react'
import { useStore } from 'zustand'
import { EnvironmentConnectionsContext } from '@/providers/environment-connections-context'
import { requireContext } from '@/lib/require-context'

export function useAuth() {
  const connections = use(EnvironmentConnectionsContext)
  requireContext(connections, 'Machine authentication requires EnvironmentTransportsProvider.')
  const state = useStore(connections.authStore)
  return { ...state, answer: connections.answerAuth }
}
