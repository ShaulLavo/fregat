import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { fail } from './errors.mjs'

export const primaryMetrics = ['inputApplied', 'textCallback']
export const secondaryMetrics = ['inputFrame', 'visibleTextUpperBound']
const arms = ['baseline', 'control', 'candidate']
const latencyNames = [
  'attach',
  'buffer',
  'constructor',
  'openSynchronous',
  'preparation',
  'textCallback',
  'visibleTextUpperBound',
]
const hashFields = ['sourceHash', 'bundleHash', 'coreBuildHash']
const identity = (sample) => [sample.fixture, sample.mode, sample.plugin, sample.state].join('/')
const key = (sample) => `${identity(sample)}/${sample.repetition}`
const same = (left, right, label) => assert.deepEqual(left, right, label)
const finite = (value, label) => assert.ok(Number.isFinite(value) && value >= 0, label)
const integer = (value, label, minimum = 0) =>
  assert.ok(Number.isSafeInteger(value) && value >= minimum, label)

export async function readResult(path) {
  const bytes = await readFile(path)
  return JSON.parse((path.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8'))
}

export function validateRun(result) {
  same(result.schemaVersion, 1, 'schema')
  same(result.suite, 'first-paint', 'suite')
  assert.ok(typeof result.id === 'string' && result.id.length > 0, 'run id')
  assert.ok(Number.isFinite(Date.parse(result.createdAt)), 'run timestamp')
  integer(result.config.repetitions, 'repetitions', 1)
  same(result.config.warmups, 1, 'warmup coverage')
  assert.equal(result.config.fallbackCases, true, 'fallback workload required')
  same(result.config.plugins, ['none'], 'fallback plugin configuration')
  same(result.config.states, ['cold', 'warm'], 'state coverage')
  same(new Set(result.config.modes).size, result.config.modes.length, 'duplicate modes')
  assert.ok(
    result.config.modes.every((mode) => ['direct', 'prepared'].includes(mode)),
    'modes',
  )
  assert.ok(result.config.modes.length > 0, 'missing modes')
  validateEnvironment(result.environment)
  const fixtures = result.manifest.fixtures
  assert.ok(fixtures.length > 0, 'missing fixtures')
  same(new Set(fixtures.map((fixture) => fixture.id)).size, fixtures.length, 'duplicate fixtures')
  for (const fixture of fixtures) assert.match(fixture.sha256, /^[0-9a-f]{64}$/, 'fixture hash')
  const expected = fixtures.length * result.config.modes.length * 2 * result.config.repetitions
  same(result.samples.length, expected, 'sample count')
  same(new Set(result.samples.map(key)).size, expected, 'duplicate sample')
  for (const sample of result.samples) validateSample(sample, result)
  return result
}

function validateEnvironment(environment) {
  for (const name of hashFields) assert.match(environment[name], /^[0-9a-f]{64}$/, name)
  for (const name of ['browser', 'runtime', 'cpuAffinity'])
    assert.ok(typeof environment[name] === 'string' && environment[name].length > 0, name)
  assert.ok(environment.hardware?.cpu, 'hardware')
}

function validateSample(sample, result) {
  assert.ok(result.config.modes.includes(sample.mode), 'unknown mode')
  assert.ok(result.config.states.includes(sample.state), 'unknown state')
  same(sample.plugin, 'none', 'sample plugin')
  integer(sample.repetition, 'repetition')
  assert.ok(sample.repetition < result.config.repetitions, 'repetition bounds')
  const fixture = result.manifest.fixtures.find((fixture) => fixture.id === sample.fixture)
  assert.ok(fixture, 'unknown fixture')
  same(sample.fixtureHash, fixture.sha256, 'sample fixture hash')
  same(sample.correct, true, 'sample correctness')
  same(sample.observation.correctText, true, 'text correctness')
  same(sample.observation.revision, 36, 'final revision')
  same(sample.observation.droppedDiagnostics, 0, 'dropped diagnostics')
  same(sample.cleanup.active, false, 'active document')
  same(sample.cleanup.hosts, 0, 'retained hosts')
  same(sample.cleanup.retainedObjects, 0, 'retained document')
  if (sample.cleanup.worker) same(sample.cleanup.worker.pendingRequests, 0, 'pending worker')
  assert.ok(sample.pixels.text.ink >= 20, 'missing text pixels')
  same(Object.keys(sample.latencyMs).sort(), latencyNames, 'latency coverage')
  for (const value of Object.values(sample.latencyMs)) finite(value, 'invalid latency')
  const text = sample.observation.paints.filter(
    (paint) => paint.phase === 'text' && paint.documentId === sample.fixture,
  )
  same(text.length, 1, 'text paint generation')
  assert.ok(
    Math.abs(text[0].at - sample.timing.start - sample.latencyMs.textCallback) < 1e-7,
    'text callback clock',
  )
  assert.ok(
    sample.latencyMs.visibleTextUpperBound >= sample.latencyMs.textCallback,
    'capture before callback',
  )
  validateFallback(sample.fallback)
  if (!result.config.diagnostics) same(sample.observation.diagnostics, [], 'production diagnostics')
  if (result.config.diagnostics)
    assert.ok(
      sample.observation.diagnostics.some((event) => event.name === 'editor.fallbackFoldRanges'),
      'missing fallback diagnostics',
    )
}

function validateFallback(fallback) {
  assert.ok(fallback, 'missing fallback observations')
  same(
    fallback.commands.map((command) => command.command),
    ['fold', 'unfoldAll', 'foldAll', 'unfoldAll'],
    'fold commands',
  )
  same(fallback.commands[0].changed, true, 'cold fold was skipped')
  for (const command of fallback.commands) finite(command.durationMs, 'command latency')
  same(fallback.bursts.length, 3, 'burst count')
  let previousAt = -Infinity
  for (const [index, burst] of fallback.bursts.entries())
    previousAt = validateBurst(burst, index, previousAt)
  for (const snapshot of [fallback.initialHeap, fallback.editedHeap]) validateHeap(snapshot)
  assert.ok(fallback.folded.pixels.ink >= 20, 'missing folded pixels')
}

function validateBurst(burst, index, previousAt) {
  same(burst.events.length, 12, 'input event count')
  same(burst.revision, (index + 1) * 12, 'burst revision')
  integer(burst.offset, 'input offset')
  for (const event of burst.events) {
    for (const value of [event.at, event.appliedAt, event.frameAt]) finite(value, 'input clock')
    assert.ok(event.at <= event.appliedAt && event.appliedAt <= event.frameAt, 'input clock order')
    assert.ok(event.at > previousAt, 'input event order')
    previousAt = event.at
  }
  return previousAt
}

function validateHeap(snapshot) {
  assert.ok(snapshot, 'missing memory snapshot')
  for (const name of ['usedSize', 'totalSize', 'backingStorageSize'])
    finite(snapshot[name], 'memory value')
}

export function validateExperiment(design, blocks) {
  same(design.schemaVersion, 1, 'design schema')
  same(design.primaryMetrics, primaryMetrics, 'primary metric definition')
  same(design.secondaryMetrics, secondaryMetrics, 'secondary metric definition')
  same(design.regressionMarginMs, 0, 'strict margin')
  same(design.numericalEpsilonMs, 1e-7, 'floating-point comparison epsilon')
  integer(design.seed, 'bootstrap seed')
  assert.ok(design.seed <= 0xffffffff, 'bootstrap seed must fit uint32')
  assert.ok(['pilot', 'final'].includes(design.purpose), 'design purpose')
  integer(design.bootstrapDraws, 'bootstrap draws', 1000)
  assert.ok(design.familywiseAlpha > 0 && design.familywiseAlpha < 0.5, 'alpha')
  assert.ok(Number.isFinite(design.clockQuantumMs) && design.clockQuantumMs > 0, 'clock quantum')
  assert.ok(blocks.length > 0, 'missing blocks')
  same(new Set(blocks.map((block) => block.id)).size, blocks.length, 'duplicate blocks')
  const reference = blocks[0].baseline
  const runs = blocks.flatMap((block) => arms.map((arm) => block[arm]))
  same(new Set(runs.map((run) => run.id)).size, runs.length, 'duplicate run ids')
  for (const run of runs) validateComparable(run, reference)
  for (const block of blocks) validateBlock(block, blocks[0])
  if (design.purpose === 'final') validateFinalDesign(design, blocks)
}

function validateComparable(run, reference) {
  validateRun(run)
  same(run.config.diagnostics, false, 'production timing required')
  same(run.config, reference.config, 'configuration mismatch')
  same(run.manifest, reference.manifest, 'manifest mismatch')
  for (const field of ['browser', 'runtime', 'hardware', 'cpuAffinity'])
    same(run.environment[field], reference.environment[field], `environment mismatch: ${field}`)
}

function validateBlock(block, first) {
  same([...block.order].sort(), [...arms].sort(), 'block order')
  const times = block.order.map((arm) => Date.parse(block[arm].createdAt))
  assert.ok(
    times.every((time, index) => index === 0 || time > times[index - 1]),
    'recorded run order',
  )
  for (const arm of arms) {
    for (const field of hashFields)
      same(
        block[arm].environment[field],
        first[arm].environment[field],
        `source drift: ${arm}/${field}`,
      )
  }
  for (const field of hashFields)
    same(
      block.baseline.environment[field],
      block.control.environment[field],
      `unchanged control: ${field}`,
    )
}

export function validateFinalBlockCount(count) {
  integer(count, 'final block count', 12)
  same(count % 6, 0, 'final block count must be divisible by six')
}

export function validateFinalBlocks(blocks) {
  assert.ok(Array.isArray(blocks), 'final blocks must be an array')
  validateFinalBlockCount(blocks.length)
  const orders = new Map()
  for (const block of blocks) {
    same([...block.order].sort(), [...arms].sort(), 'block order')
    orders.set(block.order.join(','), (orders.get(block.order.join(',')) ?? 0) + 1)
  }
  same(orders.size, 6, 'all six run orders required')
  assert.ok(
    [...orders.values()].every((count) => count === blocks.length / 6),
    'balanced order frequency',
  )
}

function validateFinalDesign(design, blocks) {
  validateFinalBlocks(blocks)
  same(blocks[0].baseline.config.repetitions, 5, 'final design requires five documents per group')
  same(blocks[0].baseline.config.modes, ['direct', 'prepared'], 'final attachment coverage')
  same(
    blocks[0].baseline.manifest.fixtures.map((fixture) => fixture.id),
    ['short-lines'],
    'final stress fixture',
  )
  same(
    blocks[0].baseline.manifest.fixtures[0].sha256,
    '1e1bd3e405a41e11241ad87baacf631e877dccdef975eef36ee9aa59981ce3c9',
    'frozen E034 fixture',
  )
  assert.ok(Number.isFinite(Date.parse(design.predeclaredAt)), 'preregistration timestamp')
  for (const block of blocks) {
    for (const arm of arms)
      assert.ok(
        Date.parse(design.predeclaredAt) < Date.parse(block[arm].createdAt),
        'capture predates design',
      )
  }
}

function valuesFor(run, group, metric) {
  const samples = run.samples.filter((sample) => identity(sample) === group)
  if (metric === 'inputApplied')
    return samples.flatMap((sample) =>
      sample.fallback.bursts.flatMap((burst) =>
        burst.events.map((event) => event.appliedAt - event.at),
      ),
    )
  if (metric === 'inputFrame')
    return samples.flatMap((sample) =>
      sample.fallback.bursts.flatMap((burst) =>
        burst.events.map((event) => event.frameAt - event.at),
      ),
    )
  return samples.map((sample) => sample.latencyMs[metric])
}

function distribution(blocks, selectedArms, group, metric) {
  const entries = blocks.flatMap((block, index) =>
    selectedArms.flatMap((arm) =>
      valuesFor(block[arm], group, metric).map((value) => [value, index]),
    ),
  )
  entries.sort((left, right) => left[0] - right[0] || left[1] - right[1])
  const totals = new Uint32Array(blocks.length)
  const values = []
  const indices = []
  const counts = []
  for (const [value, index] of entries) {
    totals[index]++
    if (values.at(-1) === value && indices.at(-1) === index) counts[counts.length - 1]++
    else {
      values.push(value)
      indices.push(index)
      counts.push(1)
    }
  }
  return {
    values: Float64Array.from(values),
    indices: Uint16Array.from(indices),
    counts: Uint32Array.from(counts),
    totals,
    size: entries.length,
  }
}

function weightedP95(distribution, weights) {
  let count = 0
  for (let index = 0; index < weights.length; index++)
    count += weights[index] * distribution.totals[index]
  const target = Math.ceil(count * 0.95)
  let cumulative = 0
  for (let index = 0; index < distribution.values.length; index++) {
    cumulative += weights[distribution.indices[index]] * distribution.counts[index]
    if (cumulative >= target) return distribution.values[index]
  }
  assert.fail('Missing quantile samples')
}

function randomGenerator(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function percentile(values, fraction) {
  const sorted = values.toSorted((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
}

function endpoint(blocks, group, metric) {
  return {
    group,
    metric,
    family: primaryMetrics.includes(metric) ? 'primary' : 'secondary',
    candidate: distribution(blocks, ['candidate'], group, metric),
    reference: distribution(blocks, ['baseline', 'control'], group, metric),
    baseline: distribution(blocks, ['baseline'], group, metric),
    control: distribution(blocks, ['control'], group, metric),
    deltas: [],
    controlDeltas: [],
  }
}

function bootstrap(endpoints, design, count) {
  const random = randomGenerator(design.seed)
  const weights = new Uint32Array(count)
  for (let draw = 0; draw < design.bootstrapDraws; draw++) {
    weights.fill(0)
    for (let block = 0; block < count; block++) weights[Math.floor(random() * count)]++
    for (const item of endpoints) sampleEndpoint(item, weights)
  }
}

function sampleEndpoint(item, weights) {
  item.deltas.push(weightedP95(item.candidate, weights) - weightedP95(item.reference, weights))
  item.controlDeltas.push(weightedP95(item.control, weights) - weightedP95(item.baseline, weights))
}

function summarizeEndpoint(item, design, weights, familySize, boundsAvailable) {
  const tail = design.familywiseAlpha / familySize
  const lowerMs = boundsAvailable ? percentile(item.deltas, tail) : null
  const upperMs = boundsAvailable ? percentile(item.deltas, 1 - tail) : null
  const controlLowerMs = boundsAvailable ? percentile(item.controlDeltas, tail) : null
  const controlUpperMs = boundsAvailable ? percentile(item.controlDeltas, 1 - tail) : null
  const candidateP95Ms = weightedP95(item.candidate, weights)
  const referenceP95Ms = weightedP95(item.reference, weights)
  return {
    group: item.group,
    metric: item.metric,
    family: item.family,
    samples: { candidate: item.candidate.size, pooledControls: item.reference.size },
    candidateP95Ms,
    referenceP95Ms,
    differenceMs: candidateP95Ms - referenceP95Ms,
    lowerMs,
    upperMs,
    strictNoRegression: boundsAvailable ? upperMs <= design.numericalEpsilonMs : null,
    demonstratedRegression: boundsAvailable ? lowerMs > design.numericalEpsilonMs : null,
    withinQuantizationEnvelope: boundsAvailable ? upperMs <= 2 * design.clockQuantumMs : null,
    control: {
      baselineP95Ms: weightedP95(item.baseline, weights),
      controlP95Ms: weightedP95(item.control, weights),
      lowerMs: controlLowerMs,
      upperMs: controlUpperMs,
      detectedDrift: boundsAvailable
        ? controlLowerMs > design.numericalEpsilonMs || controlUpperMs < -design.numericalEpsilonMs
        : null,
    },
  }
}

export function analyze(design, blocks) {
  validateExperiment(design, blocks)
  const groups = [...new Set(blocks[0].baseline.samples.map(identity))].sort()
  const endpoints = groups.flatMap((group) =>
    [...primaryMetrics, ...secondaryMetrics].map((metric) => endpoint(blocks, group, metric)),
  )
  const boundsAvailable = blocks.length >= 6
  if (boundsAvailable) bootstrap(endpoints, design, blocks.length)
  const weights = new Uint32Array(blocks.length).fill(1)
  const metrics = endpoints.map((item) =>
    summarizeEndpoint(item, design, weights, groups.length * 2, boundsAvailable),
  )
  const primary = metrics.filter((item) => item.family === 'primary')
  const controlStable = boundsAvailable ? !primary.some((item) => item.control.detectedDrift) : null
  const strictBoundPassed = primary.every((item) => item.strictNoRegression)
  const final = design.purpose === 'final'
  return {
    schemaVersion: 1,
    designHash: createHash('sha256').update(JSON.stringify(design)).digest('hex'),
    purpose: design.purpose,
    method:
      'Paired whole-block percentile bootstrap of pooled p95 differences; no individual-key or within-context resampling. One-sided Bonferroni bounds within each declared metric family.',
    uncertainty:
      'Bootstrap bounds are approximate with finite independent browser blocks, quantized clocks and a tail estimand. A nonsignificant difference is not equivalence. Warm documents share one context per arm/group and remain together in every resample.',
    blocks: blocks.length,
    boundsAvailable,
    bootstrapDraws: boundsAvailable ? design.bootstrapDraws : 0,
    familywiseAlpha: design.familywiseAlpha,
    numericalEpsilonMs: design.numericalEpsilonMs,
    quantizationEnvelopeMs: 2 * design.clockQuantumMs,
    observedClockGridMs: blocks.map((block) => ({
      block: block.id,
      ...Object.fromEntries(arms.map((arm) => [arm, observedClockGrid(block[arm])])),
    })),
    controls: {
      passed: controlStable,
      meaning:
        'No detected baseline/control arm drift; this is an instrument check, not proof of equality.',
    },
    acceptance: {
      passed: Boolean(final && controlStable && strictBoundPassed),
      status: !final ? 'pilot-only' : decision(controlStable, primary, strictBoundPassed),
      marginMs: 0,
      quantizationEnvelopeIsAcceptanceMargin: false,
    },
    runIds: blocks.map((block) => ({
      block: block.id,
      order: block.order,
      ...Object.fromEntries(arms.map((arm) => [arm, block[arm].id])),
    })),
    metrics,
  }
}

function observedClockGrid(run) {
  const timestamps = run.samples.flatMap((sample) =>
    sample.fallback.bursts.flatMap((burst) =>
      burst.events.flatMap((event) => [event.at, event.appliedAt, event.frameAt]),
    ),
  )
  const units = timestamps
    .map((value) => Math.round(value * 1000))
    .sort((left, right) => left - right)
  let divisor = 0
  for (let index = 1; index < units.length; index++)
    divisor = gcd(divisor, units[index] - units[index - 1])
  return divisor / 1000
}

function gcd(left, right) {
  while (right) {
    const remainder = left % right
    left = right
    right = remainder
  }
  return left
}

function decision(controlStable, metrics, passed) {
  if (!controlStable) return 'invalid-control-drift'
  if (passed) return 'strict-no-regression-at-recorded-resolution'
  if (metrics.some((item) => item.demonstratedRegression)) return 'regression'
  return 'unresolved'
}

async function main() {
  if (process.argv.length < 3 || process.argv.length > 4)
    fail('Usage: fallback-validation.mjs design.json [report.json]')
  const designPath = resolve(process.argv[2])
  const design = JSON.parse(await readFile(designPath, 'utf8'))
  const blocks = []
  for (const block of design.blocks) {
    const runs = await Promise.all(
      arms.map((arm) => readResult(resolve(dirname(designPath), block[arm]))),
    )
    blocks.push({ ...block, ...Object.fromEntries(arms.map((arm, index) => [arm, runs[index]])) })
  }
  const report = analyze(design, blocks)
  if (process.argv[3])
    await writeFile(resolve(process.argv[3]), JSON.stringify(report, null, 2) + '\n')
  else console.log(JSON.stringify(report, null, 2))
  if (design.purpose === 'final' && !report.acceptance.passed) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main()
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
}
