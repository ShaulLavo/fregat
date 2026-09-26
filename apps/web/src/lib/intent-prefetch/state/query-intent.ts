import {
  hashKey,
  type QueryClient,
  type QueryKey,
  type QueryExecuteOptions,
} from '@tanstack/react-query'
import { hasPrefetchRoom, prefetchSurfaceEnabled } from '@/lib/intent-prefetch/state/scheduler'
import { createWideEventScope } from '@/lib/wide-event-scope'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { clientLogContext } from '@/lib/environments/state/log-context'

type Lease = { users: number; claimed: boolean; claim: () => void; end: () => void }
// Leases own cancellation only. Answers and in-flight work belong to the query cache.
const leases = new WeakMap<QueryClient, Map<string, Lease>>()
const diffReads = {
  predicate: (query: { queryKey: QueryKey }) =>
    query.queryKey[0] === 'git' && ['diffs', 'history-commit'].includes(String(query.queryKey[1])),
}

export function claimDiffIntent(client: QueryClient, key: QueryKey) {
  leases.get(client)?.get(hashKey(key))?.claim()
}

export function startDiffIntent<T, K extends QueryKey>(
  client: QueryClient,
  options: QueryExecuteOptions<T, Error, T, T, K>,
  trigger: string,
  enabled = prefetchSurfaceEnabled('diffs'),
) {
  if (!enabled) return () => {}
  let owned = leases.get(client)
  if (!owned) {
    owned = new Map()
    leases.set(client, owned)
  }
  const key = hashKey(options.queryKey)
  const existing = owned.get(key)
  if (existing) {
    existing.users++
    return () => releaseDiffIntent(client, options.queryKey, existing)
  }
  const started = performance.now()
  const event = createWideEventScope({
    ...clientLogContext(clientForQueryClient(client)),
    action: 'prefetch.intent',
    area: 'git',
    surface: 'diffs',
    trigger,
    inFlight: client.isFetching(diffReads),
  })
  if (!hasPrefetchRoom('diffs', client, diffReads, enabled)) {
    event.end({ outcome: 'skipped-budget' })
    return () => {}
  }
  const lease: Lease = {
    users: 1,
    // An earlier imperative read belongs to its caller, even without a mounted observer.
    claimed: client.getQueryState(options.queryKey)?.fetchStatus === 'fetching',
    end: () => event.end({ outcome: lease.claimed ? 'partial' : 'evicted' }),
    claim: () => {
      lease.claimed = true
      event.end({
        outcome: client.getQueryData(options.queryKey) === undefined ? 'partial' : 'hit',
        leadMs: performance.now() - started,
      })
    },
  }
  owned.set(key, lease)
  void client.query(options).then(
    (data) =>
      event.set({
        prepareMs: performance.now() - started,
        bytes: new TextEncoder().encode(JSON.stringify(data)).byteLength,
        workerMs: 0,
      }),
    () =>
      event.end({
        outcome: client.getQueryState(options.queryKey)?.status === 'error' ? 'failed' : 'aborted',
      }),
  )
  return () => releaseDiffIntent(client, options.queryKey, lease)
}

function releaseDiffIntent(client: QueryClient, key: QueryKey, lease: Lease) {
  if (--lease.users > 0) return
  lease.end()
  leases.get(client)?.delete(hashKey(key))
  const query = client.getQueryCache().find({ queryKey: key, exact: true })
  if (!lease.claimed && query?.getObserversCount() === 0)
    void client.cancelQueries({ queryKey: key, exact: true })
}
