import { useStore } from 'zustand'

import type { SettingsSession } from '@/connection/state/session'

/** The connected session's settings owner and environment, or null and '' while offline. */
export function useReadySession(session: SettingsSession) {
  const environmentId = useStore(session.store, (state) =>
    state.kind === 'ready' ? state.descriptor.environmentId : '',
  )
  const owner = useStore(session.store, (state) => (state.kind === 'ready' ? state.owner : null))
  return { environmentId, owner }
}
