import { fail } from './errors.mjs'
import { correlateInputEvents } from './input-correlation.mjs'

export const inputScenarios = Object.freeze([
  'typing',
  'repeat',
  'composition-update',
  'composition-commit',
  'paste',
  'undo',
])
export const inputViewModes = Object.freeze(['single', 'multiple'])
const fixtureIds = ['ordinary', 'short-lines', 'long-line']
const metrics = ['inputToApplied', 'dispatch', 'inputToFrame', 'burstToPaintUpperBound']
const timingEpsilonMs = 0.000001
const formula =
  'max(control p95) + max(3 * range(control p95), 3 * range(control p50), max(control max - control min))'

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`Missing ${label}`)
}

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail(`Missing ${label}`)
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail(`Invalid ${label}`)
}

function finite(value, label) {
  if (!Number.isFinite(value) || value < 0) fail(`Invalid ${label}`)
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  )
}

function same(left, right, label) {
  if (JSON.stringify(canonical(left)) !== JSON.stringify(canonical(right)))
    fail(`Incomparable ${label}`)
}

function keys(value, expected, label) {
  record(value, label)
  same(Object.keys(value).sort(), expected.toSorted(), `${label} coverage`)
}

function hash(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail(`Invalid ${label}`)
}

function validateEnvironment(environment) {
  record(environment, 'environment')
  text(environment.commit, 'commit')
  hash(environment.sourceHash, 'source hash')
  if (typeof environment.dirty !== 'boolean') fail('Missing working-tree status')
  record(environment.browser, 'browser')
  same(environment.browser.engine, 'chromium', 'browser engine')
  text(environment.browser.version, 'browser version')
  if (typeof environment.browser.headless !== 'boolean') fail('Missing browser display mode')
  record(environment.hardware, 'hardware')
  for (const field of ['cpu', 'architecture', 'platform', 'release'])
    text(environment.hardware[field], `hardware ${field}`)
  integer(environment.hardware.logicalCpus, 'logical CPU count', 1)
  integer(environment.hardware.memoryBytes, 'memory capacity', 1)
  text(environment.runtime, 'runner runtime')
}

function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.fixtures))
    fail('Missing fixture manifest')
  integer(manifest.generatorVersion, 'fixture generator version', 1)
  integer(manifest.seed, 'fixture seed')
  same(manifest.fixtures.map((fixture) => fixture?.id).sort(), fixtureIds.toSorted(), 'fixture')
  for (const fixture of manifest.fixtures) validateFixture(fixture)
}

function validateFixture(fixture) {
  hash(fixture.sha256, 'fixture hash')
  for (const field of ['bytes', 'utf16Length', 'normalizedLength', 'lines', 'longestLine'])
    integer(fixture[field], `fixture ${field}`, 1)
  integer(fixture.searchCount, 'fixture search count')
}

function validateConfig(config) {
  record(config, 'workload configuration')
  integer(config.repetitions, 'repetitions', 1)
  integer(config.warmups, 'warmups', 1)
  same(config.scenarios, inputScenarios, 'scenario coverage')
  same(config.views, inputViewModes, 'view coverage')
  same(config.compositionCommitTrust, 'cdp-untrusted-compositionend', 'composition commit trust')
  same(config.isolation, 'closed-browser-context-per-fixture-view-scenario', 'sample isolation')
  if (typeof config.diagnostics !== 'boolean') fail('Missing diagnostics mode')
  finite(config.slowdownMs, 'slowdown duration')
  keys(config.operationsPerSample, inputScenarios, 'operation counts')
  for (const scenario of inputScenarios)
    integer(config.operationsPerSample[scenario], `${scenario} operation count`, 1)
}

export function validateInputResult(result) {
  if (
    result?.schemaVersion !== 1 ||
    result.suite !== 'input-latency' ||
    !Array.isArray(result.samples)
  )
    fail('Unsupported input-latency result schema')
  if (result.smokeOnly !== undefined && result.smokeOnly !== false)
    fail('Smoke-only results cannot establish an input latency budget')
  text(result.id, 'run id')
  validateEnvironment(result.environment)
  validateManifest(result.manifest)
  validateConfig(result.config)
  const seen = new Set()
  for (const sample of result.samples) validateSample(sample, result, seen)
  const expected =
    fixtureIds.length * inputViewModes.length * inputScenarios.length * result.config.repetitions
  if (seen.size !== expected) fail(`Missing samples: expected ${expected}, got ${seen.size}`)
  return result
}

function validateSample(sample, result, seen) {
  record(sample, 'sample')
  const fixture = result.manifest.fixtures.find((entry) => entry.id === sample.fixture)
  if (
    !fixture ||
    !inputViewModes.includes(sample.views) ||
    !inputScenarios.includes(sample.scenario) ||
    sample.state !== 'warm'
  )
    fail('Unknown sample configuration')
  integer(sample.repetition, 'sample repetition')
  if (sample.repetition >= result.config.repetitions) fail('Invalid sample repetition')
  const key = `${sample.fixture}/${sample.views}/${sample.scenario}/${sample.repetition}`
  if (seen.has(key)) fail(`Duplicate sample ${key}`)
  seen.add(key)
  if (sample.fixtureHash !== fixture.sha256) fail(`Fixture hash mismatch ${key}`)
  if (sample.correct !== true) fail(`Failed correctness ${key}`)
  validateCleanup(sample, key)
  validateObservation(sample, result.config)
}

function validateCleanup(sample, key) {
  record(sample.cleanup, `cleanup ${key}`)
  const cleanup = sample.cleanup
  const trackedObjects = sample.views === 'multiple' ? 4 : 2
  if (
    cleanup.active !== false ||
    cleanup.hosts !== 0 ||
    cleanup.pendingFrames !== 0 ||
    cleanup.contextClosed !== true ||
    cleanup.trackedObjects !== trackedObjects
  )
    fail(`Failed cleanup ${key}`)
  integer(cleanup.retainedObjects, 'cleanup retained object count')
  integer(cleanup.beforeListeners, 'cleanup listener count before disposal')
  integer(cleanup.afterListeners, 'cleanup listener count after disposal')
  if (cleanup.retainedObjects > trackedObjects || cleanup.afterListeners > cleanup.beforeListeners)
    fail(`Failed cleanup counts ${key}`)
}

function validateObservation(sample, config) {
  const count = config.operationsPerSample[sample.scenario]
  const observation = sample.observation
  if (!Array.isArray(observation?.events) || observation.events.length !== count)
    fail('Missing per-operation event observations')
  keys(sample.latencyMs, metrics, 'latency')
  for (const metric of metrics) {
    const expected = metric === 'burstToPaintUpperBound' ? 1 : count
    const values = sample.latencyMs[metric]
    if (!Array.isArray(values) || values.length !== expected) fail(`Missing ${metric} samples`)
    for (const value of values) finite(value, `${metric} raw latency`)
  }
  const seen = new Set()
  for (const [index, event] of observation.events.entries())
    validateEvent(sample, event, index, seen)
  validatePaint(sample)
  validateRenderedViews(sample)
  validateDiagnostics(sample, config)
}

function validateDiagnostics(sample, config) {
  const observation = sample.observation
  if (observation.droppedDiagnostics !== 0) fail('Dropped diagnostic observations')
  if (!Array.isArray(observation.diagnostics)) fail('Missing diagnostic timeline')
  if (!config.diagnostics) {
    if (observation.diagnostics.length) fail('Disabled diagnostics emitted observations')
    same(observation.correlations, null, 'disabled diagnostic correlations')
    same(observation.paint.operation, null, 'disabled paint operation')
    return
  }
  const correlations = correlateInputEvents({
    events: observation.events,
    diagnostics: observation.diagnostics,
    scenario: sample.scenario,
    views: sample.views,
    documentId: sample.fixture,
  })
  same(observation.correlations, correlations, 'input diagnostic correlations')
  same(observation.paint.operation, correlations.at(-1).operation, 'paint operation')
  same(observation.paint.revision, correlations.at(-1).revision, 'paint operation revision')
}

function validateEvent(sample, event, index, seen) {
  record(event, 'input event')
  integer(event.id, 'operation id', 1)
  if (seen.has(event.id)) fail('Duplicate operation id')
  seen.add(event.id)
  const expectedTrust = sample.scenario !== 'composition-commit'
  if (event.trusted !== expectedTrust)
    fail('Untrusted input observation or mislabeled CDP composition commit')
  text(event.eventType, 'event type')
  if (typeof event.inputType !== 'string' || typeof event.repeat !== 'boolean')
    fail('Missing input event semantics')
  validateEventSemantics(sample.scenario, event, index)
  for (const field of ['at', 'dispatchAt', 'completedAt', 'appliedAt', 'frameAt'])
    finite(event[field], `event ${field}`)
  if (
    event.at > event.dispatchAt ||
    event.dispatchAt > event.appliedAt ||
    event.appliedAt > event.completedAt ||
    event.completedAt > event.frameAt
  )
    fail('Invalid event phase ordering')
  validateRevision(sample, event, index)
  exactLatency(sample.latencyMs.inputToApplied[index], event.appliedAt - event.at, 'inputToApplied')
  exactLatency(sample.latencyMs.dispatch[index], event.completedAt - event.dispatchAt, 'dispatch')
  exactLatency(sample.latencyMs.inputToFrame[index], event.frameAt - event.at, 'inputToFrame')
}

function validateEventSemantics(scenario, event, index) {
  const eventTypes = {
    typing: ['beforeinput', 'insertText'],
    repeat: ['beforeinput', 'insertText'],
    'composition-update': ['compositionupdate', 'compositionupdate'],
    'composition-commit': ['compositionend', 'compositionend'],
    paste: ['paste', 'paste'],
    undo: ['keydown', 'keydown'],
  }
  same([event.eventType, event.inputType], eventTypes[scenario], `${scenario} event semantics`)
  if (scenario === 'repeat' && index > 0 && !event.repeat) fail('Missing native key repeat')
}

function validateRevision(sample, event, index) {
  integer(event.revisionBefore, 'revision before')
  integer(event.revisionAfter, 'revision after')
  if (sample.scenario === 'composition-update' && event.revisionAfter !== event.revisionBefore)
    fail('Composition preedit changed the document revision')
  if (sample.scenario === 'composition-update')
    exactLatency(event.appliedAt, event.completedAt, 'composition preedit completion')
  if (sample.scenario !== 'composition-update' && event.revisionAfter <= event.revisionBefore)
    fail('Input did not commit a new document revision')
  const previous = sample.observation.events[index - 1]
  if (previous && event.revisionBefore !== previous.revisionAfter)
    fail('Disconnected operation revisions')
  if (previous && event.at < previous.at) fail('Input observations are out of order')
}

function exactLatency(actual, expected, label) {
  if (Math.abs(actual - expected) > timingEpsilonMs) fail(`Latency disagrees with event ${label}`)
}

function validatePaint(sample) {
  const paint = sample.observation.paint
  if (paint?.method !== 'screenshot-completion-upper-bound')
    fail('Missing screenshot paint observation')
  if (paint.imageChanged !== true) fail('Screenshot has missing or unchanged pixels')
  finite(paint.startedAt, 'screenshot start')
  finite(paint.completedAt, 'screenshot completion')
  const events = sample.observation.events
  const last = events.at(-1)
  same(sample.observation.revision, last.revisionAfter, 'final observed revision')
  same(paint.revision, last.revisionAfter, 'paint revision')
  if (
    paint.startedAt < last.completedAt ||
    paint.completedAt < paint.startedAt ||
    events.some((event) => event.frameAt > paint.completedAt)
  )
    fail('Invalid screenshot phase ordering')
  exactLatency(
    sample.latencyMs.burstToPaintUpperBound[0],
    paint.completedAt - events[0].at,
    'burstToPaintUpperBound',
  )
}

function validateRenderedViews(sample) {
  const rendered = sample.observation.rendered
  const count = sample.views === 'multiple' ? 3 : 1
  if (!Array.isArray(rendered) || rendered.length !== count)
    fail('Missing rendered view observations')
  for (const [index, view] of rendered.entries()) {
    if (view?.view !== index || view.hidden !== false || view.verifiedText !== true)
      fail('Invalid rendered view correctness')
    integer(view.rows, 'rendered row count', 1)
    integer(view.chunks, 'rendered chunk count', 1)
  }
}

function percentile(sorted, fraction) {
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
}

function distribution(rawSamples) {
  const sorted = rawSamples.toSorted((left, right) => left - right)
  return {
    count: sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: sorted.at(-1),
    rawSamples,
  }
}

function groups(result) {
  const grouped = new Map()
  for (const sample of result.samples) addGroups(grouped, sample)
  return grouped
}

function addGroups(grouped, sample) {
  for (const [metric, values] of Object.entries(sample.latencyMs)) {
    const key = `${sample.fixture}/${sample.views}/${sample.scenario}/${metric}`
    const existing = grouped.get(key) ?? []
    existing.push(...values)
    grouped.set(key, existing)
  }
}

export function summarizeInputResult(result) {
  validateInputResult(result)
  return Object.fromEntries([...groups(result)].map(([key, values]) => [key, distribution(values)]))
}

function comparable(left, right, allowSlowdown = false) {
  validateInputResult(left)
  validateInputResult(right)
  same(left.manifest, right.manifest, 'fixture manifests/hashes')
  const candidateConfig = allowSlowdown
    ? { ...right.config, slowdownMs: left.config.slowdownMs }
    : right.config
  same(left.config, candidateConfig, 'workload options or repetitions')
  same(left.environment.browser, right.environment.browser, 'browser')
  same(left.environment.hardware, right.environment.hardware, 'hardware')
  same(left.environment.runtime, right.environment.runtime, 'runner runtime')
}

function range(values) {
  return Math.max(...values) - Math.min(...values)
}

function controlLimit(summaries, key) {
  const controlP50Ms = summaries.map((summary) => summary[key].p50Ms)
  const controlP95Ms = summaries.map((summary) => summary[key].p95Ms)
  const controlMinMs = summaries.map((summary) => Math.min(...summary[key].rawSamples))
  const controlMaxMs = summaries.map((summary) => summary[key].maxMs)
  const noiseMarginMs = Math.max(
    3 * range(controlP95Ms),
    3 * range(controlP50Ms),
    ...controlMaxMs.map((value, index) => value - controlMinMs[index]),
  )
  return {
    p95Ms: Math.max(...controlP95Ms) + noiseMarginMs,
    noiseMarginMs,
    controlP50Ms,
    controlP95Ms,
    controlMinMs,
    controlMaxMs,
  }
}

export function calibrateInput(controls) {
  if (!Array.isArray(controls) || controls.length < 3)
    fail('Calibration requires three independent unchanged control runs')
  if (new Set(controls.map((control) => control?.id)).size !== controls.length)
    fail('Calibration requires distinct control runs')
  const first = controls[0]
  for (const control of controls) {
    comparable(first, control)
    if (control.config.slowdownMs !== 0)
      fail('Calibration requires clean controls without injected delay')
    same(first.environment.commit, control.environment.commit, 'control commits')
    same(first.environment.sourceHash, control.environment.sourceHash, 'control source trees')
  }
  const summaries = controls.map(summarizeInputResult)
  return {
    schemaVersion: 1,
    suite: 'input-latency',
    kind: 'local-control-envelope',
    scope:
      'Matching browser, hardware and workload only; requires an independent rerun and delayed control.',
    formula,
    controls: controls.map((control) => control.id),
    controlRuns: controls,
    limits: Object.fromEntries(
      Object.keys(summaries[0]).map((key) => [key, controlLimit(summaries, key)]),
    ),
  }
}

function validateCalibration(baseline, calibration) {
  if (
    calibration?.schemaVersion !== 1 ||
    calibration.suite !== 'input-latency' ||
    !Array.isArray(calibration.controlRuns)
  )
    fail('Unsupported input-latency calibration schema')
  same(
    calibration,
    calibrateInput(calibration.controlRuns),
    'calibration derived from raw controls',
  )
  const storedBaseline = calibration.controlRuns.find((control) => control.id === baseline.id)
  if (!storedBaseline) fail('Calibration does not identify this baseline')
  same(baseline, storedBaseline, 'calibration baseline observations')
}

export function compareInput(baseline, candidate, calibration, { allowSlowdown = false } = {}) {
  comparable(baseline, candidate, allowSlowdown)
  validateCalibration(baseline, calibration)
  if (calibration.controls.includes(candidate.id)) fail('Candidate must be an independent run')
  if (allowSlowdown && candidate.config.slowdownMs <= 0)
    fail('Slowdown control requires an injected delay')
  const reference = summarizeInputResult(baseline)
  const proposed = summarizeInputResult(candidate)
  const results = Object.entries(proposed).map(([key, value]) => {
    const limit = calibration.limits[key]
    return {
      key,
      blocking: !key.endsWith('/burstToPaintUpperBound'),
      ...value,
      baseline: reference[key],
      limit,
      limitToControlP95Ratio:
        Math.max(...limit.controlP95Ms) === 0
          ? null
          : limit.p95Ms / Math.max(...limit.controlP95Ms),
      passed: value.p95Ms - limit.p95Ms <= timingEpsilonMs,
    }
  })
  return {
    schemaVersion: 1,
    suite: 'input-latency',
    baseline: baseline.id,
    candidate: candidate.id,
    kind: allowSlowdown ? 'delayed-control' : 'candidate',
    comparisonEpsilonMs: timingEpsilonMs,
    passed: results.every((metric) => !metric.blocking || metric.passed),
    metrics: results,
  }
}
