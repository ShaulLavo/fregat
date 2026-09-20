import { QueryObserver, type QueryClient } from '@tanstack/react-query'
import { scopedSessionKey, type OrchestrationSessionSearchMatch } from '@workspace/contracts'
import type { SessionSearchOwner } from '@/features/chat-mode/utils/session-search-owners'
import type { SessionSearchResult } from '@/features/chat-mode/state/session-search-store'
import { sessionSearchQueryOptions } from '@/features/chat-mode/utils/session-search-query'

type OwnerResult = {
  readonly owner: SessionSearchOwner
  readonly matches: readonly OrchestrationSessionSearchMatch[]
  readonly pending: boolean
  readonly failed: boolean
}

export function observeSessionSearch({
  query,
  owners,
  queryClientForOrigin,
  publish,
}: {
  readonly query: string
  readonly owners: readonly SessionSearchOwner[]
  readonly queryClientForOrigin: (origin: string) => QueryClient
  readonly publish: (result: SessionSearchResult) => void
}) {
  let active = true
  const results: OwnerResult[] = owners.map((owner) => ({
    owner,
    matches: [],
    pending: owner.connected,
    failed: !owner.connected,
  }))
  const notify = () => {
    if (active) publish(aggregateSearchResults(results))
  }
  const cleanups = owners.map((owner, index) => {
    if (!owner.connected) return () => {}
    const observer = new QueryObserver(
      queryClientForOrigin(owner.origin),
      sessionSearchQueryOptions({ query }),
    )
    const update = () => {
      const result = observer.getCurrentResult()
      results[index] = {
        owner,
        matches: result.data?.matches ?? [],
        pending: result.isFetching,
        failed: result.isError,
      }
      notify()
    }
    const unsubscribe = observer.subscribe(update)
    update()
    return unsubscribe
  })
  notify()
  return () => {
    active = false
    for (const cleanup of cleanups) cleanup()
  }
}

function aggregateSearchResults(results: readonly OwnerResult[]): SessionSearchResult {
  return {
    matchBySessionKey: Object.fromEntries(
      results.flatMap(({ owner, matches }) =>
        matches.map((match) => [
          scopedSessionKey({ environmentId: owner.environmentId, sessionId: match.sessionId }),
          match,
        ]),
      ),
    ),
    searching: results.some((result) => result.pending),
    unavailable: results.filter((result) => result.failed).map((result) => result.owner.label),
  }
}
