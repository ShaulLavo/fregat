import { createObservableStore } from '@/host/state/observable-store'
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
  let current = new AbortController()

  const store = createObservableStore<State>({
    key: '',
    kind: 'empty',
    matches: [],
    message: '',
    truncated: false,
  })
  const publish = store.replace
  async function search(query: WorkspaceSearchQuery) {
    if (store.disposed) return
    current.abort()
    const controller = new AbortController()
    current = controller
    if (!query.query) {
      publish({ key: '', kind: 'empty', matches: [], message: '', truncated: false })
      return
    }

    // The run owns its State: it finishes after a later `search()` has already
    // replaced the shared one, so logging from that reports the wrong run.
    let run: State = {
      key: JSON.stringify(query),
      kind: 'loading',
      matches: [],
      message: '',
      truncated: false,
    }
    publish(run)
    const startedAt = performance.now()
    let outcome: SearchOutcome = 'aborted'
    let recorded = false
    const record = () => {
      if (recorded) return
      recorded = true
      recordSearch(query, controller.signal, startedAt, run, outcome)
    }

    // No `kind: 'ready'` on loop exit: reaching it proves a terminal `done`
    // already set the state, because the producer throws otherwise.
    try {
      for await (const event of streamWorkspaceSearch(query, controller.signal, client)) {
        if (controller.signal.aborted) return
        if (event.type === 'match') run = { ...run, matches: [...run.matches, event.match] }
        if (event.type === 'warning') run = { ...run, message: event.message }
        if (event.type === 'done') run = { ...run, kind: 'ready', truncated: event.truncated }
        publish(run)
      }
      outcome = run.truncated ? 'truncated' : 'complete'
    } catch (error) {
      outcome = 'failed'
      if (!controller.signal.aborted) {
        run = { ...run, kind: 'failed', message: connectionFailure(error).message }
        publish(run)
      }
    } finally {
      record()
    }
  }

  /** One wide event per run. Nothing under `search/` logged at all before this. */
  function recordSearch(
    query: WorkspaceSearchQuery,
    signal: AbortSignal,
    startedAt: number,
    run: State,
    outcome: SearchOutcome,
  ) {
    recordObservabilityInfo('tui.search.run', {
      area: 'search',
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      matchCount: run.matches.length,
      matchMode: query.matchMode ?? 'literal',
      outcome: signal.aborted ? 'aborted' : outcome,
      path: query.path,
      queryLength: query.query.length,
      truncated: run.truncated,
    })
  }

  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    search,
    dispose() {
      store.dispose()
      current.abort()
    },
  }
}
