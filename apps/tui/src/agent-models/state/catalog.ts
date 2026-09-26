import { createObservableStore } from '@/host/state/observable-store'
import * as v from 'valibot'
import { providerListResultSchema, type ProviderSnapshot } from '@workspace/contracts'
import type { Client } from '@workspace/client-core/transport/client'
import { normalizeEdenDates } from '@workspace/client-core/transport/normalize-dates'
import { requireEdenData } from '@workspace/client-core/transport/eden'
import { connectionFailure } from '@/connection/utils/failure'

type State = {
  readonly kind: 'loading' | 'ready' | 'failed'
  readonly providers: readonly ProviderSnapshot[]
  readonly error: string | null
}

export function createProviderCatalog(client: Client) {
  const store = createObservableStore<State>({ kind: 'loading', providers: [], error: null })
  let request = new AbortController()

  const publish = store.replace
  async function refresh() {
    if (store.disposed) return
    request.abort()
    request = new AbortController()
    const signal = request.signal
    publish({ ...store.value, kind: 'loading', error: null })
    try {
      const data = requireEdenData(await client.providers.get({ fetch: { signal } }))
      const result = v.parse(providerListResultSchema, normalizeEdenDates(data))
      if (!signal.aborted) publish({ kind: 'ready', providers: result.providers, error: null })
    } catch (error) {
      if (!signal.aborted)
        publish({ ...store.value, kind: 'failed', error: connectionFailure(error).message })
    }
  }
  return {
    refresh,
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    dispose() {
      store.dispose()
      request.abort()
    },
  }
}
