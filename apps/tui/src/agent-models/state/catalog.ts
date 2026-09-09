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
  let state: State = { kind: 'loading', providers: [], error: null }
  let request = new AbortController()
  let disposed = false
  const listeners = new Set<() => void>()
  function publish(next: State) {
    if (disposed) return
    state = next
    for (const listener of listeners) listener()
  }
  async function refresh() {
    if (disposed) return
    request.abort()
    request = new AbortController()
    const signal = request.signal
    publish({ ...state, kind: 'loading', error: null })
    try {
      const data = requireEdenData(await client.providers.get({ fetch: { signal } }))
      const result = v.parse(providerListResultSchema, normalizeEdenDates(data))
      if (!signal.aborted) publish({ kind: 'ready', providers: result.providers, error: null })
    } catch (error) {
      if (!signal.aborted)
        publish({ ...state, kind: 'failed', error: connectionFailure(error).message })
    }
  }
  return {
    refresh,
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      disposed = true
      request.abort()
      listeners.clear()
    },
  }
}
