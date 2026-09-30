import { fail } from './errors.mjs'

export const scenarios = ['open', 'jump', 'typing', 'find-all', 'scroll', 'churn']
export const states = ['cold', 'warm']

function percentile(values, fraction) {
  if (!values.length || values.some((value) => !Number.isFinite(value) || value < 0))
    fail('Missing or invalid raw samples')
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
}

function same(left, right, label) {
  if (JSON.stringify(left) !== JSON.stringify(right)) fail(`Incomparable ${label}`)
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`Invalid ${label}`)
}

function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`Invalid ${label}`)
}

export function validateResult(result) {
  if (result?.schemaVersion !== 1 || !Array.isArray(result.samples))
    fail('Unsupported result schema')
  if (
    !result.environment?.commit ||
    !result.environment.browser?.version ||
    !result.environment.hardware?.cpu
  )
    fail('Missing environment metadata')
  if (
    result.manifest?.schemaVersion !== 1 ||
    !Array.isArray(result.manifest.fixtures) ||
    !result.manifest.fixtures.length
  )
    fail('Missing fixture manifest')
  positiveInteger(result.config?.repetitions, 'repetitions')
  positiveInteger(result.config?.warmups, 'warmups')
  same(result.config.scenarios, scenarios, 'scenario coverage')
  const fixtures = new Set(result.manifest.fixtures.map((fixture) => fixture.id))
  if (fixtures.size !== result.manifest.fixtures.length) fail('Duplicate fixture ids')
  const keys = new Set()
  for (const sample of result.samples) validateSample(sample, result, fixtures, keys)
  const expected = fixtures.size * scenarios.length * states.length * result.config.repetitions
  if (keys.size !== expected) fail(`Missing samples: expected ${expected}, got ${keys.size}`)
  return result
}

function validateSample(sample, result, fixtures, keys) {
  if (
    !fixtures.has(sample.fixture) ||
    !scenarios.includes(sample.scenario) ||
    !states.includes(sample.state)
  )
    fail('Unknown sample configuration')
  if (
    !Number.isInteger(sample.repetition) ||
    sample.repetition < 0 ||
    sample.repetition >= result.config.repetitions
  )
    fail('Invalid repetition')
  const key = `${sample.fixture}/${sample.scenario}/${sample.state}/${sample.repetition}`
  if (keys.has(key)) fail(`Duplicate sample ${key}`)
  keys.add(key)
  const fixture = result.manifest.fixtures.find((entry) => entry.id === sample.fixture)
  if (!/^[a-f0-9]{64}$/.test(fixture.sha256) || sample.fixtureHash !== fixture.sha256)
    fail(`Fixture hash mismatch ${key}`)
  if (
    sample.correct !== true ||
    !sample.observation ||
    !sample.cleanup ||
    sample.cleanup.active ||
    sample.cleanup.hosts !== 0 ||
    sample.cleanup.pendingFrames !== 0
  )
    fail(`Failed correctness or cleanup ${key}`)
  nonnegativeInteger(sample.cleanup.trackedObjects, `tracked objects ${key}`)
  nonnegativeInteger(sample.cleanup.retainedObjects, `retained objects ${key}`)
  if (sample.cleanup.retainedObjects > sample.cleanup.trackedObjects)
    fail(`Retained objects exceed tracked objects ${key}`)
  if (!sample.latencyMs || !Object.keys(sample.latencyMs).length) fail(`Missing latency ${key}`)
  for (const values of Object.values(sample.latencyMs)) {
    if (!Array.isArray(values)) fail(`Raw latency samples required ${key}`)
    percentile(values, 0.95)
  }
  validateLatencyCoverage(sample, result.config)
  if (
    sample.scenario === 'typing' &&
    sample.latencyMs.keyToApplied?.length !== result.config.typedText.length
  )
    fail(`Missing keystrokes ${key}`)
  if (sample.memory?.status !== 'supported' && sample.memory?.status !== 'unsupported')
    fail(`Missing memory capability ${key}`)
  if (sample.memory.status === 'unsupported' && !sample.memory.reason)
    fail(`Missing unsupported-memory reason ${key}`)
  if (sample.memory.status === 'supported') validateMemory(sample.memory, sample.scenario)
}

function validateLatencyCoverage(sample, config) {
  const expected = expectedLatencies(sample, config)
  same(Object.keys(sample.latencyMs).sort(), Object.keys(expected).sort(), 'latency coverage')
  for (const [metric, count] of Object.entries(expected)) {
    if (sample.latencyMs[metric].length !== count) fail(`Missing ${metric} samples`)
  }
}

function expectedLatencies(sample, config) {
  if (sample.scenario === 'typing')
    return {
      keyToApplied: config.typedText.length,
      keyToFrame: config.typedText.length,
      burstToPaintUpperBound: 1,
    }
  if (sample.scenario === 'jump') return { commandToPaintUpperBound: 1 }
  if (sample.scenario === 'find-all') return { queryToCount: 1 }
  if (sample.scenario === 'scroll') return { wheelToPaintUpperBound: 5 }
  if (sample.scenario === 'churn') return { editDelete: 1 }
  if (sample.fixture === 'ordinary')
    return { attach: 1, visibleTextUpperBound: 1, highlightedPaintUpperBound: 1 }
  return { attach: 1, visibleTextUpperBound: 1 }
}

function validateMemory(memory, scenario) {
  if (scenario === 'churn' && !memory.postChurn) fail('Missing post-churn memory snapshot')
  for (const snapshot of [
    memory.before,
    memory.after,
    ...(memory.postChurn ? [memory.postChurn] : []),
  ]) {
    if (!snapshot) fail('Missing memory snapshot')
    percentile(
      ['usedBytes', 'totalBytes', 'documents', 'nodes', 'jsEventListeners'].map(
        (field) => snapshot[field],
      ),
      0.5,
    )
  }
}

function comparable(left, right) {
  validateResult(left)
  validateResult(right)
  same(left.manifest, right.manifest, 'fixture manifests/hashes')
  same(left.config, right.config, 'feature options or repetitions')
  same(left.environment.browser, right.environment.browser, 'browser')
  same(left.environment.hardware, right.environment.hardware, 'hardware')
  same(left.environment.runtime, right.environment.runtime, 'runner runtime')
  same(memoryCapabilities(left), memoryCapabilities(right), 'memory capabilities per sample')
}

function memoryCapabilities(result) {
  return result.samples
    .map(
      (sample) =>
        `${sample.fixture}/${sample.scenario}/${sample.state}/${sample.repetition}/${sample.memory.status}`,
    )
    .sort()
}

function groups(result) {
  const grouped = new Map()
  for (const sample of result.samples) {
    for (const [metric, values] of Object.entries(sample.latencyMs)) {
      const key = `${sample.fixture}/${sample.scenario}/${sample.state}/${metric}`
      grouped.set(key, [...(grouped.get(key) ?? []), ...values])
    }
  }
  return grouped
}

function resourceGroups(result) {
  const grouped = new Map()
  for (const sample of result.samples) {
    if (sample.memory.status !== 'supported') continue
    addResourceSample(grouped, sample)
  }
  return grouped
}

function addResourceSample(grouped, sample) {
  const prefix = `${sample.fixture}/${sample.scenario}/${sample.state}`
  const counts = {
    heapBytes: sample.memory.after.usedBytes,
    nodes: sample.memory.after.nodes,
    listeners: sample.memory.after.jsEventListeners,
    retainedObjects: sample.cleanup.retainedObjects,
  }
  if (sample.memory.postChurn) counts.postChurnHeapBytes = sample.memory.postChurn.usedBytes
  for (const [metric, value] of Object.entries(counts)) {
    const key = `${prefix}/${metric}`
    grouped.set(key, [...(grouped.get(key) ?? []), value])
  }
}

export function calibrate(controls) {
  if (controls.length < 3) fail('Calibration requires three independent unchanged control runs')
  if (new Set(controls.map((control) => control.id)).size !== controls.length)
    fail('Calibration requires distinct control runs')
  const first = controls[0]
  for (const control of controls) {
    comparable(first, control)
    same(first.environment.commit, control.environment.commit, 'control commits')
    same(first.environment.sourceHash, control.environment.sourceHash, 'control source trees')
  }
  const grouped = controls.map(groups)
  const limits = {}
  for (const key of grouped[0].keys()) limits[key] = controlLimit(grouped, key)
  const resourceControls = controls.map(resourceGroups)
  const resourceLimits = {}
  for (const key of resourceControls[0].keys())
    resourceLimits[key] = resourceLimit(resourceControls, key)
  return {
    schemaVersion: 1,
    kind: 'local-control-envelope',
    controls: controls.map((run) => run.id),
    limits,
    resourceLimits,
  }
}

function resourceLimit(controls, key) {
  const maxima = controls.map((run) => percentile(run.get(key) ?? [], 1))
  return {
    max: Math.max(...maxima) + 3 * (Math.max(...maxima) - Math.min(...maxima)),
    controlMaxima: maxima,
  }
}

function controlLimit(grouped, key) {
  const medians = grouped.map((run) => percentile(run.get(key) ?? [], 0.5))
  const tails = grouped.map((run) => percentile(run.get(key) ?? [], 0.95))
  const spread = Math.max(...medians) - Math.min(...medians)
  const tailSpread = Math.max(...tails) - Math.min(...tails)
  return {
    p50Ms:
      Math.max(...medians) +
      Math.max(spread * 3, ...tails.map((tail, index) => tail - medians[index])),
    p95Ms: Math.max(...tails) + Math.max(tailSpread * 3, spread * 3),
    controlP50Ms: medians,
    controlP95Ms: tails,
  }
}

export function compare(baseline, candidate, calibration) {
  comparable(baseline, candidate)
  if (calibration?.schemaVersion !== 1 || !calibration.controls?.includes(baseline.id))
    fail('Calibration does not identify this baseline')
  const reference = groups(baseline)
  const proposed = groups(candidate)
  same([...reference.keys()].sort(), [...proposed.keys()].sort(), 'metric coverage')
  same([...reference.keys()].sort(), Object.keys(calibration.limits).sort(), 'calibration coverage')
  const metrics = [...proposed].map(([key, values]) => {
    const limit = calibration.limits[key]
    if (
      !Number.isFinite(limit.p50Ms) ||
      !Number.isFinite(limit.p95Ms) ||
      limit.p50Ms < 0 ||
      limit.p95Ms < limit.p50Ms
    )
      fail(`Invalid tolerance ${key}`)
    const p50Ms = percentile(values, 0.5)
    const p95Ms = percentile(values, 0.95)
    return {
      key,
      p50Ms,
      p95Ms,
      baselineP50Ms: percentile(reference.get(key), 0.5),
      limit,
      passed: p50Ms <= limit.p50Ms && p95Ms <= limit.p95Ms,
    }
  })
  const resources = compareResources(baseline, candidate, calibration.resourceLimits)
  return {
    passed: metrics.every((metric) => metric.passed) && resources.every((metric) => metric.passed),
    metrics,
    resources,
  }
}

function compareResources(baseline, candidate, limits) {
  const reference = resourceGroups(baseline)
  const proposed = resourceGroups(candidate)
  same([...reference.keys()].sort(), [...proposed.keys()].sort(), 'memory capabilities')
  same(
    [...reference.keys()].sort(),
    Object.keys(limits ?? {}).sort(),
    'resource calibration coverage',
  )
  return [...proposed].map(([key, values]) => {
    const max = percentile(values, 1)
    const limit = limits[key]
    if (!Number.isFinite(limit.max) || limit.max < 0) fail(`Invalid resource limit ${key}`)
    return { key, max, limit, passed: max <= limit.max }
  })
}
