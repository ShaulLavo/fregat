import type { BenchmarkFamily, BenchmarkMode } from './workloads'
import { createScriptError } from '../structured-errors'

export type BenchmarkUnit = 'ms' | 'bytes' | 'count'
export type BenchmarkSample = {
  readonly family: BenchmarkFamily
  readonly fixture: string
  readonly engine: 'remark'
  readonly domain: 'native' | 'browser'
  readonly build: 'source' | 'development' | 'production'
  readonly trial: number
  readonly revision: number
  readonly field: string
  readonly sample: number
  readonly unit: BenchmarkUnit
  readonly sourceBytes: number
  readonly outputMatches: boolean | null
  readonly cacheState: string
  readonly outputDigest?: string
  readonly detail?: {
    readonly parseMs: number
    readonly projectionMs: number
    readonly cpuMs: number
    readonly convertedBlocks: number
    readonly reusedBlocks: number
    readonly unchangedProjection: boolean
  }
}

export type MissingMeasurement = {
  readonly status: 'NOT_MEASURED'
  readonly fields: readonly string[]
  readonly reason: string
}

export type FamilyResult = {
  readonly family: BenchmarkFamily
  readonly status: 'BASELINE_ONLY' | 'FAILED' | 'NOT_MEASURED'
  readonly measurements: readonly string[]
  readonly missing: readonly MissingMeasurement[]
  readonly failures: readonly string[]
}

export type BenchmarkSummary = {
  readonly family: BenchmarkFamily
  readonly fixture: string
  readonly domain: BenchmarkSample['domain']
  readonly field: string
  readonly unit: BenchmarkUnit
  readonly sampleCount: number
  readonly independentTrials: number
  readonly p50: number
  readonly p95: number
  readonly minimum: number
  readonly maximum: number
  readonly outputMatches: boolean | null
}

export type BenchmarkReport = {
  readonly schemaVersion: 1
  readonly verdict: 'NOT VERIFIED'
  readonly mode: BenchmarkMode
  readonly candidate: MissingMeasurement
  readonly pairedQualification: MissingMeasurement
  readonly metadata: {
    readonly startedAt: string
    readonly finishedAt: string
    readonly revision: string
    readonly lockfileSha256: string
    readonly trackedDiffSha256: string
    readonly workloadSources: readonly {
      readonly id: string
      readonly sourceBytes: number
      readonly sha256: string
    }[]
    readonly runtime: string
    readonly platform: string
    readonly architecture: string
    readonly hardware: string
    readonly logicalCpuCount: number
    readonly trials: number
    readonly warmups: number
    readonly timingStatus: 'EXPLORATORY'
    readonly measurementBoundary: string
    readonly gcAvailable: boolean
    readonly wasm: MissingMeasurement
    readonly browser:
      | MissingMeasurement
      | { readonly status: 'EXPLORATORY'; readonly records: number; readonly logSha256: string }
  }
  readonly families: readonly FamilyResult[]
  readonly rawSamples: readonly BenchmarkSample[]
  readonly summaries: readonly BenchmarkSummary[]
  readonly unmeasuredCells: readonly {
    readonly family: BenchmarkFamily
    readonly fixture: string
    readonly schedule: string
    readonly status: 'NOT_MEASURED'
    readonly reason: string
  }[]
  readonly resources: {
    readonly created: readonly string[]
    readonly cleanup: readonly string[]
    readonly retained: readonly string[]
  }
}

export function summarizeBenchmarks(samples: readonly BenchmarkSample[]): BenchmarkSummary[] {
  const groups = new Map<string, BenchmarkSample[]>()
  for (const sample of samples) {
    const key = JSON.stringify([
      sample.family,
      sample.fixture,
      sample.domain,
      sample.field,
      sample.unit,
    ])
    const group = groups.get(key) ?? []
    group.push(sample)
    groups.set(key, group)
  }
  return Array.from(groups.values(), summarizeGroup)
}

export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = values.toSorted((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0
}

function summarizeGroup(samples: readonly BenchmarkSample[]): BenchmarkSummary {
  const first = samples[0]
  if (!first)
    throw createScriptError('A benchmark summary requires a sample', {
      internal: { sampleCount: samples.length },
    })
  const values = samples.map((sample) => sample.sample)
  return {
    family: first.family,
    fixture: first.fixture,
    domain: first.domain,
    field: first.field,
    unit: first.unit,
    sampleCount: samples.length,
    independentTrials: new Set(samples.map((sample) => sample.trial)).size,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    minimum: values.reduce((minimum, value) => Math.min(minimum, value), Number.POSITIVE_INFINITY),
    maximum: values.reduce((maximum, value) => Math.max(maximum, value), Number.NEGATIVE_INFINITY),
    outputMatches: samples.some((sample) => sample.outputMatches === false)
      ? false
      : samples.some((sample) => sample.outputMatches === null)
        ? null
        : true,
  }
}
