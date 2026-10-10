import { prepareFileTreeInput } from '@workspace/tree'
import { TreeViewModel } from '@/features/workspace/state/tree-model'

const PATH_COUNTS = [10_000, 50_000] as const
const WARMUP_ROUNDS = 3
const SAMPLE_ROUNDS = 9
const REMOUNT_SPEEDUP_GATE = 0.2
const COLD_SLOWDOWN_GATE = 0.15

type TimingSample = {
  readonly preparedColdMs: number
  readonly preparedRemountMs: number
  readonly rawColdMs: number
  readonly rawRemountMs: number
}

type BenchmarkResult = {
  readonly pathCount: number
  readonly preparedColdMedianMs: number
  readonly preparedRemountMedianMs: number
  readonly rawColdMedianMs: number
  readonly rawRemountMedianMs: number
  readonly coldSlowdown: number
  readonly remountSpeedup: number
}

const gate = process.argv.includes('--gate')
const results = PATH_COUNTS.map(runBenchmark)

console.log(`FILE_TREE_PREPARED_INPUT_BENCHMARK ${JSON.stringify(results, null, 2)}`)

if (gate) enforceGate(results)

function runBenchmark(pathCount: number): BenchmarkResult {
  const paths = deterministicPaths(pathCount)

  for (let round = 0; round < WARMUP_ROUNDS; round += 1) {
    measureRound(paths)
  }

  const samples: TimingSample[] = []
  for (let round = 0; round < SAMPLE_ROUNDS; round += 1) {
    samples.push(measureRound(paths))
  }

  const preparedColdMedianMs = median(samples.map((sample) => sample.preparedColdMs))
  const preparedRemountMedianMs = median(samples.map((sample) => sample.preparedRemountMs))
  const rawColdMedianMs = median(samples.map((sample) => sample.rawColdMs))
  const rawRemountMedianMs = median(samples.map((sample) => sample.rawRemountMs))

  return {
    pathCount,
    preparedColdMedianMs: round(preparedColdMedianMs),
    preparedRemountMedianMs: round(preparedRemountMedianMs),
    rawColdMedianMs: round(rawColdMedianMs),
    rawRemountMedianMs: round(rawRemountMedianMs),
    coldSlowdown: round(ratio(preparedColdMedianMs - rawColdMedianMs, rawColdMedianMs)),
    remountSpeedup: round(ratio(rawRemountMedianMs - preparedRemountMedianMs, rawRemountMedianMs)),
  }
}

function measureRound(paths: readonly string[]): TimingSample {
  const rawCold = measureConstruction({ paths })
  const rawRemount = measureConstruction({ paths })

  const preparedColdStartedAt = performance.now()
  const preparedInput = prepareFileTreeInput(paths, { flattenEmptyDirectories: true })
  new TreeViewModel({
    flattenEmptyDirectories: true,
    preparedInput,
  })
  const preparedColdMs = performance.now() - preparedColdStartedAt

  const preparedRemount = measureConstruction({ preparedInput })

  return {
    preparedColdMs,
    preparedRemountMs: preparedRemount,
    rawColdMs: rawCold,
    rawRemountMs: rawRemount,
  }
}

function measureConstruction(options: ConstructorParameters<typeof TreeViewModel>[0]): number {
  const startedAt = performance.now()
  new TreeViewModel({ flattenEmptyDirectories: true, ...options })
  return performance.now() - startedAt
}

function deterministicPaths(pathCount: number): readonly string[] {
  const paths: string[] = []

  for (let index = 0; index < pathCount; index += 1) {
    const group = index % 250
    const feature = Math.floor(index / 250) % 40
    const directory = `packages/package-${String(group).padStart(3, '0')}/feature-${String(feature).padStart(2, '0')}`
    if (index % 11 === 0) {
      paths.push(`${directory}/nested-${String(index).padStart(5, '0')}/`)
      continue
    }

    const extension = index % 5 === 0 ? 'tsx' : 'ts'
    paths.push(`${directory}/file-${String(index).padStart(5, '0')}.${extension}`)
  }

  return paths
}

function enforceGate(results: readonly BenchmarkResult[]) {
  const largeResult = results.find((result) => result.pathCount === 50_000)
  if (!largeResult) {
    console.error('FILE_TREE_PREPARED_INPUT_GATE_FAILED missing 50k result')
    process.exitCode = 1
    return
  }

  const failures: string[] = []
  if (largeResult.remountSpeedup < REMOUNT_SPEEDUP_GATE) {
    failures.push(
      `cached remount speedup ${formatPercent(largeResult.remountSpeedup)} is below ${formatPercent(REMOUNT_SPEEDUP_GATE)}`,
    )
  }
  if (largeResult.coldSlowdown > COLD_SLOWDOWN_GATE) {
    failures.push(
      `cold slowdown ${formatPercent(largeResult.coldSlowdown)} exceeds ${formatPercent(COLD_SLOWDOWN_GATE)}`,
    )
  }
  if (failures.length === 0) {
    console.log('FILE_TREE_PREPARED_INPUT_GATE_PASSED')
    return
  }

  console.error(`FILE_TREE_PREPARED_INPUT_GATE_FAILED ${JSON.stringify(failures)}`)
  process.exitCode = 1
}

function median(values: number[]): number {
  const sorted = values.sort((left, right) => left - right)
  const midpoint = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[midpoint] ?? 0

  return ((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2
}

function ratio(delta: number, baseline: number): number {
  if (baseline === 0) return 0

  return delta / baseline
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

function formatPercent(value: number): string {
  return `${String(round(value * 100))}%`
}
