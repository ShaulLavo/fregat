import type { Client } from '@workspace/client-core/transport/client'
import { streamWorkspaceSearch } from '@workspace/client-core/files/search-client'
import type { WorkspaceSearchMatch, WorkspaceSearchQuery } from '@workspace/contracts'
import { recordObservabilityInfo } from '@workspace/observability'
import { connectionFailure } from '@/connection/utils/failure'

type State = {
  key: string
  kind: 'empty' | 'loading' | 'ready' | 'failed'
  matches: readonly WorkspaceSearchMatch[]
  message: string
  truncated: boolean
}

type SearchOutcome = 'complete' | 'truncated' | 'aborted' | 'failed'

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
    const startedAt = performance.now()
    try {
      for await (const event of streamWorkspaceSearch(query, controller.signal, client)) {
        if (controller.signal.aborted) return
        if (event.type === 'match') publish({ ...state, matches: [...state.matches, event.match] })
        if (event.type === 'warning') publish({ ...state, message: event.message })
        if (event.type === 'done') publish({ ...state, kind: 'ready', truncated: event.truncated })
      }
      // No `kind: 'ready'` on loop exit. That was the defect: it fired whether or
      // not a terminal `done` arrived, so a stream that simply ended published a
      // complete-looking result with `truncated: false` — and the replace gate
      // reads exactly those two fields. Reaching here now means `done` was seen
      // and already set the state, because the producer throws otherwise.
      recordSearch(query, controller.signal, startedAt, state.truncated ? 'truncated' : 'complete')
    } catch (error) {
      recordSearch(query, controller.signal, startedAt, 'failed')
      if (!controller.signal.aborted)
        publish({ ...state, kind: 'failed', message: connectionFailure(error).message })
    }
  }

  // One wide event per run. Nothing under `apps/tui/src/search` logged at all
  // before this, which is why an incomplete search leading to a whole-file
  // replacement left no trace connecting the two.
  function recordSearch(
    query: WorkspaceSearchQuery,
    signal: AbortSignal,
    startedAt: number,
    outcome: SearchOutcome,
  ) {
    recordObservabilityInfo('tui.search.run', {
      area: 'search',
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      matchCount: state.matches.length,
      matchMode: query.matchMode ?? 'literal',
      outcome: signal.aborted ? 'aborted' : outcome,
      path: query.path,
      queryLength: query.query.length,
      truncated: state.truncated,
    })
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
