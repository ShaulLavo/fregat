import { elapsedMs, roundMs } from '@workspace/utils/timing'
import type {
  WorkspaceSearchMeasurement,
  WorkspaceSearchIndexMeasurement,
  WorkspaceSearchProviderMeasurement,
  WorkspaceSearchProviderSource,
  WorkspaceSearchStatPathCount,
} from '@workspace/contracts'

const TOP_STAT_PATH_LIMIT = 20

export type SearchProviderRun = WorkspaceSearchProviderMeasurement & {
  startedAt: number
}

type MutableProviderMeasurement = SearchProviderRun
type StatMeasurement = {
  count: number
  durationMs: number
}

export class SearchMeasurementRecorder {
  private readonly startedAt = performance.now()
  private readonly providers: MutableProviderMeasurement[] = []
  private readonly activeProviders: MutableProviderMeasurement[] = []
  private readonly statsByPath = new Map<string, StatMeasurement>()
  private firstResultMs: number | undefined
  private workspaceIndex: WorkspaceSearchIndexMeasurement | undefined

  startProvider(source: WorkspaceSearchProviderSource) {
    const provider: MutableProviderMeasurement = {
      durationMs: 0,
      resultCount: 0,
      source,
      startedAt: performance.now(),
      statCallCount: 0,
      statDurationMs: 0,
    }

    this.providers.push(provider)
    this.activeProviders.push(provider)
    return provider
  }

  endProvider(provider: MutableProviderMeasurement) {
    provider.durationMs = elapsedMs(provider.startedAt)

    const index = this.activeProviders.lastIndexOf(provider)
    if (index === -1) return

    this.activeProviders.splice(index, 1)
  }

  recordProviderResult(provider: MutableProviderMeasurement) {
    provider.resultCount += 1
    if (provider.firstResultMs === undefined) {
      provider.firstResultMs = elapsedMs(provider.startedAt)
    }

    this.recordResult()
  }

  async measureStat<T>(path: string, operation: () => Promise<T>) {
    const startedAt = performance.now()

    try {
      return await operation()
    } finally {
      this.recordStat(path, elapsedMs(startedAt))
    }
  }

  recordStat(path: string, durationMs: number) {
    const measurement = this.statsByPath.get(path) ?? { count: 0, durationMs: 0 }
    measurement.count += 1
    measurement.durationMs = roundMs(measurement.durationMs + durationMs)
    this.statsByPath.set(path, measurement)

    const provider = this.activeProviders.at(-1)
    if (!provider) return

    provider.statCallCount += 1
    provider.statDurationMs = roundMs(provider.statDurationMs + durationMs)
  }

  recordWorkspaceIndex(measurement: WorkspaceSearchIndexMeasurement) {
    this.workspaceIndex = measurement
  }

  snapshot(): WorkspaceSearchMeasurement {
    const snapshot: WorkspaceSearchMeasurement = {
      durationMs: elapsedMs(this.startedAt),
      firstResultMs: this.firstResultMs,
      providerSources: providerSources(this.providers),
      providers: this.providers.map(providerMeasurement),
      repeatedStatPathCount: repeatedStatPathCount(this.statsByPath),
      statCallCount: statCallCount(this.statsByPath),
      statDurationMs: statDurationMs(this.statsByPath),
      statPathCount: this.statsByPath.size,
      topStatPaths: topStatPaths(this.statsByPath),
    }

    if (this.workspaceIndex) snapshot.workspaceIndex = this.workspaceIndex

    return snapshot
  }

  private recordResult() {
    if (this.firstResultMs !== undefined) return

    this.firstResultMs = elapsedMs(this.startedAt)
  }
}

function providerSources(providers: readonly WorkspaceSearchProviderMeasurement[]) {
  return [...new Set(providers.map((provider) => provider.source))]
}

function providerMeasurement(
  provider: MutableProviderMeasurement,
): WorkspaceSearchProviderMeasurement {
  return {
    durationMs: provider.durationMs,
    firstResultMs: provider.firstResultMs,
    resultCount: provider.resultCount,
    source: provider.source,
    statCallCount: provider.statCallCount,
    statDurationMs: provider.statDurationMs,
  }
}

function statCallCount(statsByPath: ReadonlyMap<string, StatMeasurement>) {
  let total = 0

  for (const measurement of statsByPath.values()) {
    total += measurement.count
  }

  return total
}

function statDurationMs(statsByPath: ReadonlyMap<string, StatMeasurement>) {
  let total = 0

  for (const measurement of statsByPath.values()) {
    total += measurement.durationMs
  }

  return roundMs(total)
}

function repeatedStatPathCount(statsByPath: ReadonlyMap<string, StatMeasurement>) {
  let total = 0

  for (const measurement of statsByPath.values()) {
    if (measurement.count < 2) continue

    total += 1
  }

  return total
}

function topStatPaths(statsByPath: ReadonlyMap<string, StatMeasurement>) {
  return Array.from(statsByPath, ([path, measurement]) => ({ path, ...measurement }))
    .sort(compareStatPathCount)
    .slice(0, TOP_STAT_PATH_LIMIT)
}

function compareStatPathCount(
  left: WorkspaceSearchStatPathCount,
  right: WorkspaceSearchStatPathCount,
) {
  if (left.count !== right.count) return right.count - left.count

  return left.path.localeCompare(right.path)
}
