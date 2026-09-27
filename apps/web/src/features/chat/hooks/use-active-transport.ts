import { useStore } from 'zustand'
import type { EnvironmentId } from '@workspace/contracts'

import { activeTransports } from '@/features/chat/state/active-transports'

/** The environment's live chat transport, or null until one registers. */
export function useActiveTransport(environmentId: EnvironmentId) {
  return useStore(activeTransports, (transports) => transports.get(environmentId) ?? null)
}
