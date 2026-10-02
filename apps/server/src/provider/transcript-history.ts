import { Database } from 'bun:sqlite'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { QueryClient } from '@tanstack/query-core'
import { createStore, type StoreApi } from 'zustand/vanilla'
import * as v from 'valibot'
import {
  providerUsageHistoryCoverageSchema,
  type ProviderUsageHistoryCoverage,
  type ProviderUsageHistoryQuery,
  type ProviderUsageHistorySource,
} from '@workspace/contracts'
import { recordProcessInfo, recordProcessWarning } from '../observability/runtime'
import { aggregateTranscriptHistory, type ProviderUsageHistoryReader } from './usage-history'
import {
  deduplicateTranscriptRecords,
  type LocalPriceCatalog,
  type TranscriptRecord,
} from './utils/transcript-records'
import {
  scanTranscriptFile,
  transcriptFileCacheSchema,
  walkTranscriptRoot,
  type TranscriptFileCache,
  type TranscriptScanLimits,
  type TranscriptSource,
} from './utils/transcript-scan'

export type LocalTranscriptUsageOptions = {
  readonly cacheDirectory: string
  readonly hostId: string
  readonly sources: readonly TranscriptSource[]
  readonly priceCatalog: LocalPriceCatalog
  readonly limits: TranscriptScanLimits
  readonly now?: () => number
  readonly utilityHistory?: ProviderUsageHistoryReader
}

type Snapshot = {
  readonly records: readonly TranscriptRecord[]
  readonly failedPasses: number
  readonly coverage: ProviderUsageHistoryCoverage
}
type Discovery = {
  iterator: AsyncGenerator<string | null>
  root: number
  pendingFile: string | null
  readableRoots: number
  absentRoots: number
  failedRoots: number
  failedFiles: number
}

/** One local scan owner. History and timezone changes only project the last committed snapshot. */
export class LocalTranscriptUsageService {
  private readonly queries = new QueryClient()
  private readonly shutdown = new AbortController()
  private readonly files = new Map<string, TranscriptFileCache>()
  private readonly discovery = new Map<string, Discovery>()
  private database: Database | null = null
  readonly store: StoreApi<Snapshot>
  private readonly now: () => number

  private readonly options: LocalTranscriptUsageOptions

  constructor(options: LocalTranscriptUsageOptions) {
    this.options = options
    this.now = options.now ?? Date.now
    this.store = createStore<Snapshot>(() => ({
      records: [],
      failedPasses: 0,
      coverage: {
        scope: 'local-transcripts',
        accountAttribution: 'unverified',
        costMeaning: 'api-equivalent-estimate',
        status: 'pending',
        scannedAt: null,
        bytesRead: 0,
        sources: options.sources.map((source) => this.emptySource(source)),
      },
    }))
  }

  async initialize() {
    await mkdir(this.options.cacheDirectory, { recursive: true, mode: 0o700 })
    const path = join(this.options.cacheDirectory, 'transcript-history.sqlite')
    try {
      this.database = openCache(path)
    } catch {
      recordProcessWarning('provider.transcript_history.cache_invalid', {
        fallback: 'bounded-rescan',
        reason: 'database-invalid',
      })
      for (const suffix of ['', '-wal', '-shm']) await rm(path + suffix, { force: true })
      this.database = openCache(path)
    }
    let rejected = 0
    for (const row of this.database
      .query<{ id: string; value: string }, []>('SELECT id, value FROM files')
      .all()) {
      const file = parseCache(transcriptFileCacheSchema, row.value)
      if (!file || !this.options.sources.some((source) => source.id === file.sourceId)) {
        rejected++
        continue
      }
      this.files.set(row.id, file)
    }
    const metadata = this.database
      .query<{ value: string }, []>('SELECT value FROM metadata WHERE id = 1')
      .get()
    const coverage = metadata && parseCache(providerUsageHistoryCoverageSchema, metadata.value)
    if (coverage && coverage.sources.every((source) => source.hostId === this.options.hostId)) {
      const cachedSources = new Map(coverage.sources.map((source) => [source.id, source]))
      this.publish({
        ...coverage,
        status: rejected || coverage.status === 'scanning' ? 'partial' : coverage.status,
        sources: this.options.sources.map((source) => {
          const cached = cachedSources.get(source.id)
          if (!cached || rejected) return this.emptySource(source)
          return cached
        }),
      })
    } else this.publish(this.store.getState().coverage)
    if (rejected)
      recordProcessWarning('provider.transcript_history.cache_invalid', {
        fallback: 'bounded-rescan',
        rejectedFiles: rejected,
      })
  }

  read(query: ProviderUsageHistoryQuery) {
    const snapshot = this.store.getState()
    const utilities = this.options.utilityHistory?.readUtilities(query) ?? []
    const coverage = { ...snapshot.coverage, sources: [...snapshot.coverage.sources] }
    if (this.options.utilityHistory)
      coverage.sources.push({
        id: 'fregat-utility',
        hostId: this.options.hostId,
        driverKind: 'fregat',
        sourceKind: 'fregat-utility',
        status: 'ready',
        scannedAt: new Date(this.now()).toISOString(),
        latestEventAt: utilities.reduce<string | null>(
          (latest, row) => (!latest || row.recordedAt > latest ? row.recordedAt : latest),
          null,
        ),
        files: 0,
        records: utilities.length,
        malformedLines: 0,
        oversizedLines: 0,
        unidentifiedRecords: 0,
      })
    return {
      ...aggregateTranscriptHistory([...snapshot.records, ...utilities], query, this.now()),
      coverage,
    }
  }

  /** TanStack owns in-flight coalescing; refresh work never runs from a history read. */
  async refresh(options: { readonly signal?: AbortSignal } = {}) {
    if (this.shutdown.signal.aborted) return
    return this.queries.query({
      queryKey: ['provider', 'local-transcript-history'],
      queryFn: ({ signal }) =>
        this.scan(
          AbortSignal.any([
            signal,
            this.shutdown.signal,
            ...(options.signal ? [options.signal] : []),
          ]),
        ),
      staleTime: 0,
      gcTime: Infinity,
      retry: false,
      networkMode: 'always',
    })
  }

  close() {
    this.shutdown.abort()
    this.queries.clear()
    for (const discovery of this.discovery.values()) void discovery.iterator.return(undefined)
    this.discovery.clear()
    this.database?.close()
    this.database = null
  }

  private emptySource(source: TranscriptSource): ProviderUsageHistorySource {
    return {
      id: source.id,
      hostId: this.options.hostId,
      driverKind: source.driverKind,
      sourceKind: 'native-transcript',
      unidentifiedRecords: 0,
      status: 'pending',
      scannedAt: null,
      latestEventAt: null,
      files: 0,
      records: 0,
      malformedLines: 0,
      oversizedLines: 0,
    }
  }

  private async scan(signal: AbortSignal) {
    const before = this.store.getState()
    this.store.setState({ ...before, coverage: { ...before.coverage, status: 'scanning' } })
    let remaining = this.options.limits.maxBytes
    let visits = this.options.limits.maxFiles
    let bytesRead = 0
    let failures = 0
    const updates = new Map<string, TranscriptFileCache>()
    const sources: ProviderUsageHistorySource[] = []
    try {
      for (const source of this.options.sources) {
        signal.throwIfAborted()
        const status = await this.scanSource(source, { remaining, visits, signal, updates })
        remaining -= status.bytesRead
        visits -= status.visits
        bytesRead += status.bytesRead
        failures += status.failures
        sources.push(status.source)
      }
      signal.throwIfAborted()
      const coverage: ProviderUsageHistoryCoverage = {
        ...before.coverage,
        sources,
        bytesRead,
        scannedAt: new Date(this.now()).toISOString(),
        status: sources.some((source) => source.status !== 'ready') ? 'partial' : 'ready',
      }
      // Cache writes and publication settle together; cancellation leaves the previous report intact.
      this.database?.transaction(() => {
        for (const [id, file] of updates)
          this.database
            ?.query('INSERT OR REPLACE INTO files(id,value) VALUES(?,?)')
            .run(id, JSON.stringify(file))
        this.database
          ?.query('INSERT OR REPLACE INTO metadata(id,value) VALUES(1,?)')
          .run(JSON.stringify(coverage))
      })()
      for (const [id, file] of updates) this.files.set(id, file)
      this.publish(coverage)
      const event = {
        bytesRead,
        filesVisited: this.options.limits.maxFiles - visits,
        records: this.store.getState().records.length,
        failedReads: failures,
        coverage: coverage.status,
      }
      this.store.setState({ failedPasses: failures ? before.failedPasses + 1 : 0 })
      if (failures && !before.failedPasses)
        recordProcessWarning('provider.transcript_history.scanned', event)
      if (!failures && (before.failedPasses || before.coverage.status !== coverage.status))
        recordProcessInfo('provider.transcript_history.scanned', {
          ...event,
          recoveredPasses: before.failedPasses,
        })
      return coverage
    } catch (error) {
      this.store.setState(before)
      // Discovery cursors move before publication; retry starts a fresh bounded traversal.
      for (const discovery of this.discovery.values()) await discovery.iterator.return(undefined)
      this.discovery.clear()
      if (!signal.aborted) {
        this.store.setState({ failedPasses: before.failedPasses + 1 })
        if (!before.failedPasses)
          recordProcessWarning('provider.transcript_history.scan_failed', {
            reason: error instanceof Error ? error.name : 'unknown-failure',
            fallback: 'last-complete-report',
          })
      }
      throw error
    }
  }

  private async scanSource(
    source: TranscriptSource,
    budget: {
      remaining: number
      visits: number
      signal: AbortSignal
      updates: Map<string, TranscriptFileCache>
    },
  ) {
    if (!source.roots.length)
      return {
        bytesRead: 0,
        visits: 0,
        failures: 0,
        source: { ...this.emptySource(source), status: 'absent' as const },
      }
    let discovery = this.discovery.get(source.id)
    if (!discovery) {
      discovery = {
        iterator: walkTranscriptRoot(source.roots[0] ?? ''),
        root: 0,
        pendingFile: null,
        readableRoots: 0,
        absentRoots: 0,
        failedRoots: 0,
        failedFiles: 0,
      }
      this.discovery.set(source.id, discovery)
    }
    let bytesRead = 0
    let visits = 0
    let failures = 0
    let complete = false
    while (visits < budget.visits && bytesRead < budget.remaining) {
      budget.signal.throwIfAborted()
      let entry: IteratorResult<string | null>
      try {
        entry = discovery.pendingFile
          ? { done: false, value: discovery.pendingFile }
          : await discovery.iterator.next()
        discovery.pendingFile = null
      } catch (error) {
        if (isAbsent(error)) discovery.absentRoots++
        else {
          discovery.failedRoots++
          failures++
        }
        entry = { done: true, value: null }
      }
      visits++
      if (entry.done) {
        discovery.root++
        const root = source.roots[discovery.root]
        if (!root) {
          complete = true
          break
        }
        discovery.iterator = walkTranscriptRoot(root)
        continue
      }
      discovery.readableRoots++
      if (!entry.value) continue
      const id = JSON.stringify([source.id, entry.value])
      try {
        const result = await scanTranscriptFile({
          source,
          path: entry.value,
          previous: budget.updates.get(id) ?? this.files.get(id),
          budget: budget.remaining - bytesRead,
          limits: this.options.limits,
          catalog: this.options.priceCatalog,
          signal: budget.signal,
        })
        bytesRead += result.bytesRead
        budget.updates.set(id, result.file)
        if (!result.complete) {
          // Revisit a budget-limited file before advancing the directory walk.
          discovery.pendingFile = entry.value
          break
        }
      } catch (error) {
        if (budget.signal.aborted) throw error
        failures++
        discovery.failedFiles++
      }
    }
    const stats = this.sourceStats(source, budget.updates)
    let status: ProviderUsageHistorySource['status'] = 'partial'
    if (complete && !discovery.readableRoots && discovery.absentRoots) status = 'absent'
    else if (complete && discovery.failedRoots) status = 'unreadable'
    else if (
      complete &&
      !discovery.absentRoots &&
      !discovery.failedFiles &&
      !failures &&
      !stats.malformedLines &&
      !stats.oversizedLines &&
      !stats.unidentifiedRecords
    )
      status = 'ready'
    if (complete) this.discovery.delete(source.id)
    return {
      bytesRead,
      visits,
      failures: Math.max(failures, discovery.failedFiles + discovery.failedRoots),
      source: {
        ...this.emptySource(source),
        ...stats,
        status,
        scannedAt: new Date(this.now()).toISOString(),
      },
    }
  }

  private sourceStats(source: TranscriptSource, updates: ReadonlyMap<string, TranscriptFileCache>) {
    const files = new Map(this.files)
    for (const [id, file] of updates) files.set(id, file)
    const selected = [...files.values()].filter((file) => file.sourceId === source.id)
    const records = selected.flatMap((file) => Object.values(file.published.records))
    return {
      files: selected.length,
      records: deduplicateTranscriptRecords(records).length,
      unidentifiedRecords: records.filter((row) => row.identityKind === 'source').length,
      latestEventAt: records.reduce<string | null>(
        (latest, row) => (!latest || row.recordedAt > latest ? row.recordedAt : latest),
        null,
      ),
      malformedLines: selected.reduce((sum, file) => sum + file.published.malformedLines, 0),
      oversizedLines: selected.reduce((sum, file) => sum + file.published.oversizedLines, 0),
    }
  }

  private publish(coverage: ProviderUsageHistoryCoverage) {
    const records = deduplicateTranscriptRecords(
      [...this.files.values()].flatMap((file) => Object.values(file.published.records)),
    )
    this.store.setState({
      records,
      coverage: coverage.sources.some((source) => source.status === 'pending')
        ? { ...coverage, status: 'pending' }
        : coverage,
    })
  }
}

function openCache(path: string) {
  const database = new Database(path)
  try {
    database.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS metadata (id INTEGER PRIMARY KEY, value TEXT NOT NULL);',
    )
    database.query('SELECT id, value FROM files LIMIT 1').all()
    database.query('SELECT id, value FROM metadata LIMIT 1').all()
    return database
  } catch (error) {
    database.close()
    throw error
  }
}

function parseCache<Schema extends v.GenericSchema>(
  schema: Schema,
  text: string,
): v.InferOutput<Schema> | null {
  try {
    const parsed = v.safeParse(schema, JSON.parse(text))
    return parsed.success ? parsed.output : null
  } catch {
    return null
  }
}

function isAbsent(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
