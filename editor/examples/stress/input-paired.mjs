import { fail } from './errors.mjs'
import { inputConsumerIds, inputConsumerConfiguration } from './input-configurations.mjs'
import { inputNoiseBudget, assertInputComparable } from './input-results.mjs'

export function randomGenerator(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
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
  if (differences.length < 3 || differences.some((value) => !Number.isFinite(value)))
    fail('A paired interval requires at least three finite repetition differences')
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

export function comparePairedInput(baseline, candidate, schedule, seed) {
  assertInputComparable(baseline, candidate, true)
  for (const run of [baseline, candidate]) assertPairedReceipt(run.environment)
  if (baseline.config.unsupportedFixtures?.length)
    fail('Paired input requires every fixture to be supported')
  if (baseline.id === candidate.id) fail('Paired sides require distinct run identities')
  if (baseline.config.slowdownMs !== 0) fail('Paired baseline must have no injected delay')
  if (baseline.config.repetitions < 3) fail('Paired input requires at least three repetitions')
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
  }
  const candidateSamples = new Map(candidate.samples.map((sample) => [sampleKey(sample), sample]))
  const groups = new Map()
  for (const sample of baseline.samples) {
    const other = candidateSamples.get(sampleKey(sample))
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
  const metrics = [...groups].map(([key, group], index) => {
    const budget = inputNoiseBudget(group.baseline)
    const differenceMs = median(group.differences)
    const interval = pairedInterval(group.differences, seed + index)
    const regression = differenceMs > budget.noiseMarginMs + 0.000001 && interval.lowMs > 0
    return {
      key,
      blocking: !key.endsWith('/burstToPaintUpperBound'),
      ...group,
      differenceMs,
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
    budgetFormula:
      'max(3 * range(baseline p95), 3 * range(baseline p50), max(baseline max - baseline min))',
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

export function sensitivityPassed(check) {
  const dispatch = check.metrics.filter((metric) => metric.key.endsWith('/dispatch'))
  return (
    check.passed === false && dispatch.length === 36 && dispatch.every((metric) => !metric.passed)
  )
}

export function touchedConfigurations(baseline, candidate) {
  const before = new Map(baseline.manifest.packages.map((entry) => [entry.name, entry]))
  const after = new Map(candidate.manifest.packages.map((entry) => [entry.name, entry]))
  const changed = new Set(
    [...new Set([...before.keys(), ...after.keys()])]
      .filter((name) => {
        const prior = before.get(name)
        const next = after.get(name)
        return (
          !prior ||
          !next ||
          prior.sourceHash !== next.sourceHash ||
          prior.buildHash !== next.buildHash
        )
      })
      .map((name) => name.split('/').at(-1)),
  )
  if (changed.has('core') || changed.has('textbuffer'))
    return ['platform', ...inputConsumerIds.filter((id) => id !== 'platform')]
  const affected = inputConsumerIds.filter((id) => {
    const consumers = inputConsumerConfiguration(id, 'ordinary', 1)
    if (
      (changed.has('tree-sitter') || changed.has('tree-sitter-languages')) &&
      consumers.treeSitter
    )
      return true
    if (changed.has('minimap') && consumers.minimap) return true
    return changed.has('find') && consumers.find
  })
  return ['platform', ...affected.filter((id) => id !== 'platform')]
}
