import { QueryClient } from '@tanstack/query-core'
import type { ProviderUsageHistoryCoverage, ProviderUsageHistoryQuery } from '@workspace/contracts'
import { recordProcessInfo, recordProcessWarning } from '../observability/runtime'
import { LocalTranscriptUsageService, type LocalTranscriptUsageOptions } from './transcript-history'
import { aggregateTranscriptHistory } from './usage-history'

/** Owns the local scan schedule; route reads only project the retained service. */
export class ProviderTranscriptCollection {
  private readonly queries = new QueryClient()
  private service: LocalTranscriptUsageService | null = null
  private configuredKey: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private generation = 0
  private closed = false
  private failedPasses = 0
  private readonly options: () => LocalTranscriptUsageOptions
  private readonly intervalMs: () => number

  constructor(options: () => LocalTranscriptUsageOptions, intervalMs: () => number) {
    this.options = options
    this.intervalMs = intervalMs
  }

  read(query: ProviderUsageHistoryQuery) {
    if (this.service) return this.service.read(query)
    const coverage: ProviderUsageHistoryCoverage = {
      scope: 'local-transcripts',
      accountAttribution: 'unverified',
      costMeaning: 'api-equivalent-estimate',
      status: 'pending',
      scannedAt: null,
      bytesRead: 0,
      sources: [],
    }
    return { ...aggregateTranscriptHistory([], query, Date.now()), coverage }
  }

  async initialize() {
    if (this.closed) return
    const options = this.options()
    const key = JSON.stringify({ sources: options.sources, limits: options.limits })
    if (key === this.configuredKey) return
    await this.queries.query({
      queryKey: ['provider', 'transcript-collection', 'initialize'],
      queryFn: async () => {
        const next = new LocalTranscriptUsageService(options)
        try {
          await next.initialize()
        } catch (error) {
          next.close()
          throw error
        }
        if (this.closed) {
          next.close()
          return false
        }
        this.service?.close()
        this.service = next
        this.configuredKey = key
        return true
      },
      staleTime: 0,
      retry: false,
      networkMode: 'always',
    })
  }

  async refresh() {
    if (this.closed) return
    await this.queries.query({
      queryKey: ['provider', 'transcript-collection', 'refresh'],
      queryFn: async () => {
        await this.initialize()
        if (this.closed || !this.service) return false
        await this.service.refresh()
        return true
      },
      staleTime: 0,
      retry: false,
      networkMode: 'always',
    })
  }

  start() {
    if (this.closed) return
    if (this.timer !== null) return
    this.schedule(++this.generation, 0)
  }

  reconfigure() {
    const timer = this.timer
    if (this.closed || timer === null) return
    clearTimeout(timer)
    this.timer = null
    this.start()
  }

  private schedule(generation: number, delayMs: number) {
    const timer = setTimeout(() => {
      void this.tick(generation)
    }, delayMs)
    timer.unref()
    this.timer = timer
  }

  async close() {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    await this.queries.cancelQueries()
    this.service?.close()
    this.queries.clear()
  }

  private async tick(generation: number) {
    try {
      await this.refresh()
      if (this.failedPasses) {
        recordProcessInfo('provider.transcript_history.collection_recovered', {
          failedPasses: this.failedPasses,
        })
        this.failedPasses = 0
      }
    } catch {
      this.failedPasses += 1
      if (this.failedPasses === 1)
        recordProcessWarning('provider.transcript_history.collection_failed', {
          outcome: 'cache-retained',
        })
    }
    if (this.closed || generation !== this.generation) return
    this.schedule(generation, this.intervalMs())
  }
}
