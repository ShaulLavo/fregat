import { createHash } from 'node:crypto'
import { fail } from './errors.mjs'
import { inputConsumerIds, inputHasWorkerTreeSitter } from './input-configurations.mjs'
import { assertInputComparable, inputScenarios, inputViewModes } from './input-results.mjs'
import { canStopInputPairs } from './input-pair-stopping.mjs'
import { inputBudget } from './input-budgets.mjs'

export function randomGenerator(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

export function inputPairOrder(seed, group, repetition) {
  const block = Math.floor(repetition / 2)
  const firstBaseline = createHash('sha256').update(`${seed}\0${group}\0${block}`).digest()[0] < 128
  const baselineFirst = firstBaseline !== (repetition % 2 !== 0)
  return baselineFirst ? ['baseline', 'candidate'] : ['candidate', 'baseline']
}

function quantile(sorted, fraction) {
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
}

export function median(values) {
  const sorted = values.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function pairedInterval(differences, seed, draws = 10_000) {
  if (differences.length < 2 || differences.some((value) => !Number.isFinite(value)))
    fail('A paired interval requires at least two finite repetition differences')
  const random = randomGenerator(seed)
  const estimates = Array.from({ length: draws }, () =>
    median(
      Array.from(
        { length: differences.length },
        () => differences[Math.floor(random() * differences.length)],
      ),
    ),
  ).sort((a, b) => a - b)
  return {
    confidence: 0.95,
    lowMs: quantile(estimates, 0.025),
    highMs: quantile(estimates, 0.975),
    draws,
  }
}

export function comparePairedInput(baseline, candidate, schedule, seed, draws) {
  assertInputComparable(baseline, candidate, true)
  if (!['quiet', 'loaded'].includes(baseline.config.loadProfile))
    fail('Missing paired input load profile')
  for (const run of [baseline, candidate]) assertPairedReceipt(run.environment)
  if (baseline.config.unsupportedFixtures?.length)
    fail('Paired input requires every fixture to be supported')
  if (baseline.id === candidate.id) fail('Paired sides require distinct run identities')
  if (baseline.config.slowdownMs !== 0 || (baseline.config.frameSlowdownMs ?? 0) !== 0)
    fail('Paired baseline must have no injected delay')
  if (baseline.config.repetitions < 4 || baseline.config.repetitions % 2 !== 0)
    fail('Paired input requires at least four repetitions in complete two-pair blocks')
  if (
    baseline.environment.packageSet?.externalHash !== candidate.environment.packageSet?.externalHash
  )
    fail('Incomparable candidate external dependency bytes')
  const expected = new Set(baseline.samples.map(sampleKey))
  if (schedule.length !== expected.size) fail('Incomplete pair schedule')
  for (const pair of schedule) {
    if (!expected.delete(`${pair.group}/${pair.repetition}`)) fail('Unknown or duplicate pair')
    if (
      pair.order?.length !== 2 ||
      new Set(pair.order).size !== 2 ||
      pair.order.some((side) => !['baseline', 'candidate'].includes(side))
    )
      fail('Invalid pair order')
    if (pair.order.join(',') !== inputPairOrder(seed, pair.group, pair.repetition).join(','))
      fail('Unexpected key-local pair order')
  }
  const candidateSamples = new Map(candidate.samples.map((sample) => [sampleKey(sample), sample]))
  const groups = new Map()
  const pairedGroups = new Map()
  for (const sample of baseline.samples) {
    const other = candidateSamples.get(sampleKey(sample))
    const groupKey = `${sample.fixture}/${sample.views}/${sample.scenario}`
    const pair = pairedGroups.get(groupKey) ?? { baseline: [], candidate: [] }
    pair.baseline.push(sample)
    pair.candidate.push(other)
    pairedGroups.set(groupKey, pair)
    for (const [metric, values] of Object.entries(sample.latencyMs)) {
      const key = `${sample.fixture}/${sample.views}/${sample.scenario}/${metric}`
      const group = groups.get(key) ?? { baseline: [], candidate: [], differences: [] }
      const summarize = (raw) => {
        const sorted = raw.toSorted((a, b) => a - b)
        return {
          p50Ms: quantile(sorted, 0.5),
          p95Ms: quantile(sorted, 0.95),
          maxMs: sorted.at(-1),
          rawSamples: raw,
        }
      }
      const before = summarize(values)
      const after = summarize(other.latencyMs[metric])
      group.baseline.push(before)
      group.candidate.push(after)
      group.differences.push(after.p95Ms - before.p95Ms)
      groups.set(key, group)
    }
  }
  if (baseline.config.adaptivePairs)
    for (const [key, pair] of pairedGroups)
      if (
        pair.baseline.length === 2 &&
        !canStopInputPairs(pair, baseline.config.consumers ?? 'native', baseline.config.loadProfile)
      )
        fail(`Unjustified adaptive early stop for ${key}`)
  const metrics = Array.from(groups, ([key, group], index) => {
    const budget = inputBudget(
      baseline.config.consumers ?? 'native',
      key,
      baseline.config.loadProfile,
    )
    const differenceMs = median(group.differences)
    const interval = pairedInterval(group.differences, seed + index, draws)
    const regression = differenceMs > budget.noiseMarginMs + 0.000001 && interval.lowMs > 0
    return {
      key,
      blocking: !key.endsWith('/burstToPaintUpperBound'),
      ...group,
      differenceMs,
      frozenBudgetMs: budget.frozenNoiseMarginMs,
      budgetMs: budget.noiseMarginMs,
      budget,
      interval,
      passed: !regression,
    }
  })
  return {
    schemaVersion: 1,
    suite: 'input-latency',
    kind: 'paired-input',
    seed,
    statistic:
      'median of paired repetition p95 differences; repetition-cluster percentile bootstrap',
    budgetPolicy:
      'frozen historical noise margins; declared native inheritance for new compositions; loaded worker-backed Tree-sitter blocking margins have a 5 ms floor',
    stoppingPolicy: baseline.config.adaptivePairs || 'fixed-repetitions',
    confidenceInterpretation: baseline.config.adaptivePairs
      ? 'nominal descriptive bootstrap; conditional early stopping has no sequential coverage guarantee'
      : 'nominal repetition-cluster percentile bootstrap',
    acceptanceExclusions: baseline.config.acceptanceExclusions ?? [],
    baseline: baseline.id,
    candidate: candidate.id,
    passed: metrics.every((metric) => !metric.blocking || metric.passed),
    metrics,
  }
}

function assertPairedReceipt(environment) {
  const hashes = {
    instrument: environment.instrumentHash,
    instrumentExternal: environment.instrumentExternal,
    source: environment.packageSet?.sourceHash,
    build: environment.packageSet?.buildHash,
    external: environment.packageSet?.externalHash,
  }
  for (const [name, value] of Object.entries(hashes))
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
      fail(`Missing or invalid paired ${name} receipt`)
}

function sampleKey(sample) {
  return `${sample.fixture}/${sample.views}/${sample.scenario}/${sample.repetition}`
}

export const frameDetectionFloorKey = 'ordinary/multiple/repeat/inputToFrame'

export function sensitivityPassed(check, stage = 'input', frameFloor) {
  if (!['input', 'frame'].includes(stage)) fail('Unknown input sensitivity stage')
  const measures = stage === 'input' ? ['inputToApplied', 'dispatch'] : ['inputToFrame']
  const metrics = new Map(check.metrics.map((metric) => [metric.key, metric]))
  const required = ['ordinary', 'short-lines', 'long-line'].flatMap((fixture) =>
    inputViewModes.flatMap((views) =>
      inputScenarios.flatMap((scenario) =>
        measures.map((measure) => `${fixture}/${views}/${scenario}/${measure}`),
      ),
    ),
  )
  const floor = frameFloor?.metrics.find((metric) => metric.key === frameDetectionFloorKey)
  const admittedFloor =
    stage === 'frame' &&
    floor?.passed === false &&
    floor.budget.reference === 'native' &&
    !floor.budget.inherited &&
    metrics.get(frameDetectionFloorKey)?.budget.reference === 'native' &&
    !metrics.get(frameDetectionFloorKey)?.budget.inherited
  return (
    check.passed === false &&
    required.every(
      (key) =>
        metrics.get(key)?.passed === false ||
        (key === frameDetectionFloorKey && admittedFloor && metrics.has(key)),
    )
  )
}

export function inputMatrixConfigurations(options = {}) {
  if (options.only) return [...new Set(options.declared)]
  if (options.full) return [...inputConsumerIds]
  const defaults =
    options.loadProfile === 'loaded' ? ['native', 'disabled'] : ['platform', 'native']
  const configurations = [...new Set(defaults.concat(options.declared ?? []))]
  return configurations.filter(
    (configuration) => options.loadProfile !== 'loaded' || !inputHasWorkerTreeSitter(configuration),
  )
}
