import type { Client } from '@workspace/client-core/transport/client'
import { streamWorkspaceSearch } from '@workspace/client-core/files/search-client'
import type { WorkspaceSearchMatch, WorkspaceSearchQuery } from '@workspace/contracts'
import { connectionFailure } from '@/connection/utils/failure'

type State = {
  key: string
  kind: 'empty' | 'loading' | 'ready' | 'failed'
  matches: readonly WorkspaceSearchMatch[]
  message: string
  truncated: boolean
}
export function createSearchWorkbench(client: Client) {
  const listeners = new Set<() => void>()
  let current = new AbortController()
  let disposed = false
  let state: State = { key: '', kind: 'empty', matches: [], message: '', truncated: false }
  function publish(next: State) {
    if (disposed) return
    state = next
    for (const listener of listeners) listener()
  }
  async function search(query: WorkspaceSearchQuery) {
    if (disposed) return
    current.abort()
    const controller = new AbortController()
    current = controller
    if (!query.query) {
      publish({ key: '', kind: 'empty', matches: [], message: '', truncated: false })
      return
    }
    publish({
      key: JSON.stringify(query),
      kind: 'loading',
      matches: [],
      message: '',
      truncated: false,
    })
    try {
      for await (const event of streamWorkspaceSearch(query, controller.signal, client)) {
        if (controller.signal.aborted) return
        if (event.type === 'match') publish({ ...state, matches: [...state.matches, event.match] })
        if (event.type === 'warning') publish({ ...state, message: event.message })
        if (event.type === 'done') publish({ ...state, kind: 'ready', truncated: event.truncated })
      }
      if (!controller.signal.aborted) publish({ ...state, kind: 'ready' })
    } catch (error) {
      if (!controller.signal.aborted)
        publish({ ...state, kind: 'failed', message: connectionFailure(error).message })
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    search,
    dispose() {
      disposed = true
      current.abort()
      listeners.clear()
    },
  }
}
