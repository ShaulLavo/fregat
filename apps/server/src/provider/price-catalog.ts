import { QueryCache, QueryClient } from '@tanstack/query-core'
import * as v from 'valibot'
import type { PlatformDatabase } from '../db/client'
import { providerPriceCatalog } from '../db/schema'
import { recordProcessInfo, recordProcessWarning } from '../observability/runtime'
import { createStructuredError } from '../observability/structured-errors'
import bundledPrices from './model-prices.json'
import {
  modelPrice,
  parseModelPrices,
  priceSnapshotSchema,
  type PriceSnapshot,
} from './utils/model-prices'

const QUERY_KEY = ['provider', 'price-catalog'] as const
const REFRESH_MS = 24 * 60 * 60_000
const RETRY_MS = 5 * 60_000

/** A synchronous local lookup; refreshing never blocks a turn or the usage page. */
export class ProviderPriceCatalog {
  private readonly client = new QueryClient({
    queryCache: new QueryCache({
      onError: (error) =>
        recordProcessWarning('provider.price_catalog.refresh_failed', { error, fallback: 'local' }),
    }),
  })
  private readonly initial: PriceSnapshot
  private readonly database: PlatformDatabase
  private readonly fetcher: (url: string, init?: RequestInit) => Promise<Response>

  constructor(
    database: PlatformDatabase,
    fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch,
  ) {
    this.database = database
    this.fetcher = fetcher
    const cached = this.readCached()
    const bundled = v.parse(priceSnapshotSchema, bundledPrices)
    this.initial =
      cached && Date.parse(cached.fetchedAt) >= Date.parse(bundled.fetchedAt) ? cached : bundled
    this.client.setQueryData(QUERY_KEY, this.initial, {
      updatedAt: this.initial === cached ? Date.parse(cached.fetchedAt) : 0,
    })
  }

  lookup(driverKind: string, model: string) {
    void this.refresh()
    return modelPrice(
      this.client.getQueryData<PriceSnapshot>(QUERY_KEY) ?? this.initial,
      driverKind,
      model,
    )
  }

  async refresh() {
    const state = this.client.getQueryState(QUERY_KEY)
    if (state?.errorUpdatedAt && Date.now() - state.errorUpdatedAt < RETRY_MS) return
    try {
      await this.client.query({
        queryKey: QUERY_KEY,
        queryFn: ({ signal }) => this.download(signal),
        staleTime: REFRESH_MS,
        gcTime: Infinity,
        networkMode: 'always',
        retry: 1,
        retryDelay: 1_000,
      })
    } catch {
      // QueryCache reports one failure after retries; callers keep using local rates.
    }
  }

  close() {
    this.client.clear()
  }

  private async download(signal: AbortSignal) {
    const response = await this.fetcher('https://models.dev/api.json', {
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    })
    if (!response.ok) throw catalogError(`HTTP ${response.status}`)
    const snapshot = parseModelPrices(await response.json(), new Date().toISOString())
    signal.throwIfAborted()
    // Persist the query result in the app database so offline restarts retain the last good catalog.
    this.database
      .insert(providerPriceCatalog)
      .values({ id: 1, snapshotJson: JSON.stringify(snapshot) })
      .onConflictDoUpdate({
        target: providerPriceCatalog.id,
        set: { snapshotJson: JSON.stringify(snapshot) },
      })
      .run()
    recordProcessInfo('provider.price_catalog.refreshed', {
      models: Object.keys(snapshot.prices).length,
      fetchedAt: snapshot.fetchedAt,
    })
    return snapshot
  }

  private readCached() {
    const row = this.database.select().from(providerPriceCatalog).get()
    if (!row) return null
    try {
      return v.parse(priceSnapshotSchema, JSON.parse(row.snapshotJson))
    } catch (error) {
      recordProcessWarning('provider.price_catalog.cache_invalid', { error, fallback: 'bundled' })
      return null
    }
  }
}

function catalogError(reason: string) {
  return createStructuredError({
    code: 'provider.PRICE_CATALOG_UNAVAILABLE',
    status: 502,
    message: `Could not refresh model prices: ${reason}`,
    why: 'The catalog did not return usable pricing data; local prices remain available.',
    fix: 'Check connectivity to models.dev. The next usage lookup retries automatically.',
  })
}
