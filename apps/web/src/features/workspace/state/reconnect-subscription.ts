import { selectServerConnection } from '@workspace/client-core/environments/state/store'
import { useEnvironmentsStore } from '@/lib/environments/state/store'

export function subscribeWorkspaceReconnect(origin: string, resume: () => void) {
  let previous = selectServerConnection(useEnvironmentsStore.getState(), origin)

  return useEnvironmentsStore.subscribe((state) => {
    const connection = selectServerConnection(state, origin)
    const reconnected =
      connection.phase === 'connected' &&
      (previous.phase !== 'connected' || connection.generation !== previous.generation)
    previous = connection
    if (reconnected) resume()
  })
}
