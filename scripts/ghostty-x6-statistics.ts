import assert from 'node:assert/strict'

export const x6Protocol = {
  label: 'X6 in-process timing',
  actualBase: 'c0dc2aca7c3e69287c25930c07e00069e4f7822d',
  blocks: 40,
  repetitions: 2,
  observationsPerCount: 4,
  operationsPerObservation: 2_000,
  bootstrapResamples: 20_000,
  seed: 286006,
  ratioUpperLimit: 1.1,
  creationUpperLimit: 0.1,
  scope:
    'Direct internal manager/native operations; unopened real native-backed terminals. Public extension activation is absent at the pinned source.',
  pending: [
    'public use/dispose',
    'public creation N',
    'public original-input interception',
    'public write/frame extension route',
    'custom OSC native/public',
  ],
  aggregation:
    'Within each independent process, median of four observations per operation/count. Across processes, median paired log ratio, median creation contrast and median K_time.',
  resampling:
    '20,000 whole paired-process-vector percentile bootstrap resamples, xorshift32 seed 286006; type-7 interpolated quantiles. Same sampled process indices for all operations and counts.',
  creationContrast: '(T1000 - T1 - (999 / 99) * (T100 - T1)) / T0',
  activation:
    'Creation core + I[N > 0] * K + B * N. N=1 identifies K. Cold first internal use is reported separately and excluded from warmed steady-state ratio gates.',
  boundaries:
    'Creation values prepared before timer; public Terminal.create plus direct internal manager.install is timed, disposal excluded. Fresh use target prepared before timer; fresh setup/contribution factory included. Singleton disposal follows attachment, with exactly N other inert attachments. Timed native calls include driver branch/return overhead, exclude byte decoding. Steady zero is activated before timings and holds zero inert attachments.',
  gate: 'Positive finite T0 for every block/operation. All warmed operation/count one-sided 95% ratio upper bounds <=1.10; creation contrast one-sided 95% upper bound <=0.10. K_time reports a two-sided 95% interval. All 40 blocks required; no optional stopping, block drops, outlier filtering or GC correction.',
  environment: { browser: 'N/A', headless: 'N/A', hardwarePresentation: 'N/A' },
} as const

export const x6SteadyOperations = [
  'manager-use-fresh',
  'manager-dispose',
  'manager-key',
  'manager-text',
  'manager-paste',
  'manager-composition',
  'manager-frame',
  'native-key',
  'native-text',
  'native-paste',
  'native-write',
  'native-geometry',
] as const

export interface TimingRow {
  readonly operation: string
  readonly inert: number
  readonly milliseconds: number
  readonly operations?: number
  readonly repetition: number
}

export interface TimingBlock {
  readonly rows: readonly TimingRow[]
}

function median(values: readonly number[]): number {
  return quantile(
    [...values].sort((a, b) => a - b),
    0.5,
  )
}

function quantile(sorted: readonly number[], probability: number): number {
  assert(sorted.length > 0)
  const position = (sorted.length - 1) * probability
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower)
}

function time(block: TimingBlock, operation: string, inert: number): number {
  const selected = block.rows.filter((row) => row.operation === operation && row.inert === inert)
  assert.equal(selected.length, x6Protocol.observationsPerCount, `${operation}/${inert}`)
  for (const row of selected) {
    assert(
      Number.isFinite(row.milliseconds) && row.milliseconds > 0,
      `${operation}/${inert}: positive time`,
    )
    assert(row.repetition === 0 || row.repetition === 1)
    if (x6SteadyOperations.includes(operation as (typeof x6SteadyOperations)[number]))
      assert.equal(row.operations, x6Protocol.operationsPerObservation)
  }
  assert.equal(selected.filter((row) => row.repetition === 0).length, 2)
  return median(selected.map((row) => row.milliseconds))
}

function vector(block: TimingBlock): Record<string, number> {
  assert.equal(block.rows.length, 172)
  const result: Record<string, number> = {}
  for (const operation of x6SteadyOperations) {
    const zero = time(block, operation, 0)
    for (const inert of [100, 1_000])
      result[`${operation}/${inert}`] = Math.log(time(block, operation, inert) / zero)
  }
  const zero = time(block, 'internal-host-manager-create', 0)
  const one = time(block, 'internal-host-manager-create', 1)
  const hundred = time(block, 'internal-host-manager-create', 100)
  const thousand = time(block, 'internal-host-manager-create', 1_000)
  result.creationContrast = (thousand - one - (999 / 99) * (hundred - one)) / zero
  result.activationMilliseconds = one - zero
  for (const inert of [0, 100, 1_000])
    result[`cold-internal-first-use/${inert}`] = time(block, 'cold-internal-first-use', inert)
  return result
}

export function analyzeX6(blocks: readonly TimingBlock[]) {
  assert.equal(blocks.length, x6Protocol.blocks)
  const vectors = blocks.map(vector)
  const keys = Object.keys(vectors[0]!)
  const distributions: Record<string, number[]> = Object.fromEntries(keys.map((key) => [key, []]))
  let seed = x6Protocol.seed as number
  function randomIndex(): number {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return Math.floor(((seed >>> 0) / 0x1_0000_0000) * blocks.length)
  }
  for (let sample = 0; sample < x6Protocol.bootstrapResamples; sample += 1) {
    const indices = Array.from({ length: blocks.length }, randomIndex)
    for (const key of keys)
      distributions[key]!.push(median(indices.map((index) => vectors[index]![key]!)))
  }
  const intervals = Object.fromEntries(
    keys.map((key) => {
      const distribution = distributions[key]!.sort((a, b) => a - b)
      return [
        key,
        {
          estimate: median(vectors.map((item) => item[key]!)),
          lower95: quantile(distribution, 0.025),
          upper95: quantile(distribution, 0.975),
          oneSidedUpper95: quantile(distribution, 0.95),
        },
      ]
    }),
  )
  const ratios = x6SteadyOperations.flatMap((operation) =>
    [100, 1_000].map((inert) => {
      const interval = intervals[`${operation}/${inert}`]!
      return {
        operation,
        inert,
        ratio: Math.exp(interval.estimate),
        oneSidedUpper95: Math.exp(interval.oneSidedUpper95),
        passed: Math.exp(interval.oneSidedUpper95) <= x6Protocol.ratioUpperLimit,
      }
    }),
  )
  const creation = intervals.creationContrast!
  return {
    label: x6Protocol.label,
    scope: x6Protocol.scope,
    pending: x6Protocol.pending,
    passed:
      ratios.every((row) => row.passed) &&
      creation.oneSidedUpper95 <= x6Protocol.creationUpperLimit,
    ratios,
    creation: { ...creation, passed: creation.oneSidedUpper95 <= x6Protocol.creationUpperLimit },
    activationMilliseconds: intervals.activationMilliseconds,
    coldFirstUseMilliseconds: Object.fromEntries(
      [0, 100, 1_000].map((inert) => [inert, intervals[`cold-internal-first-use/${inert}`]]),
    ),
    vectors,
    protocol: x6Protocol,
  }
}
