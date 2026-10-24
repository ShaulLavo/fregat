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
const timingEpsilonMs = 0.000001
const metrics = ['inputToApplied', 'dispatch', 'inputToFrame', 'burstToPaintUpperBound']

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
  if (config.loadProfile !== undefined && !['quiet', 'loaded'].includes(config.loadProfile))
    fail('Unknown input load profile')
  integer(config.repetitions, 'repetitions', 1)
  integer(config.warmups, 'warmups', 1)
  same(config.scenarios, inputScenarios, 'scenario coverage')
  same(config.views, inputViewModes, 'view coverage')
  same(config.compositionCommitTrust, 'cdp-untrusted-compositionend', 'composition commit trust')
  if (
    ![
      'closed-browser-context-per-fixture-view-scenario',
      'closed-browser-context-per-configuration',
    ].includes(config.isolation)
  )
    fail('Unknown sample isolation')
  if (typeof config.diagnostics !== 'boolean') fail('Missing diagnostics mode')
  finite(config.slowdownMs, 'slowdown duration')
  if (config.frameSlowdownMs !== undefined)
    finite(config.frameSlowdownMs, 'frame slowdown duration')
  keys(config.operationsPerSample, inputScenarios, 'operation counts')
  if (config.unsupportedFixtures !== undefined) {
    if (!Array.isArray(config.unsupportedFixtures)) fail('Invalid unsupported fixture list')
    for (const id of config.unsupportedFixtures)
      if (!fixtureIds.includes(id)) fail('Unknown unsupported fixture')
  }
  if (
    config.warmupFixture !== undefined &&
    !['ordinary', 'measured'].includes(config.warmupFixture)
  )
    fail('Unknown warmup fixture policy')
  if (config.adaptivePairs) {
    same(config.adaptivePairs, 'counterbalanced-tight-within-budget', 'adaptive pair policy')
    same(config.repetitions, 4, 'adaptive maximum repetitions')
    keys(
      config.groupRepetitions,
      fixtureIds.flatMap((fixture) =>
        inputViewModes.flatMap((views) =>
          inputScenarios.map((scenario) => `${fixture}/${views}/${scenario}`),
        ),
      ),
      'adaptive group counts',
    )
    for (const count of Object.values(config.groupRepetitions)) {
      integer(count, 'adaptive repetition count', 2)
      if (count % 2 !== 0) fail('Invalid adaptive repetition count: incomplete two-pair block')
      if (count > config.repetitions) fail('Adaptive count exceeds maximum repetitions')
    }
  }
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
  if (result.config.isolation === 'closed-browser-context-per-configuration')
    validateWarmInputLifecycle(result)
  const seen = new Set()
  for (const sample of result.samples) validateSample(sample, result, seen)
  const expected = result.config.adaptivePairs
    ? Object.values(result.config.groupRepetitions).reduce((sum, count) => sum + count, 0)
    : (fixtureIds.length - (result.config.unsupportedFixtures?.length ?? 0)) *
      inputViewModes.length *
      inputScenarios.length *
      result.config.repetitions
  if (seen.size !== expected) fail(`Missing samples: expected ${expected}, got ${seen.size}`)
  return result
}

function validateSample(sample, result, seen) {
  record(sample, 'sample')
  const fixture = result.manifest.fixtures.find((entry) => entry.id === sample.fixture)
  if (
    !fixture ||
    result.config.unsupportedFixtures?.includes(fixture.id) ||
    !inputViewModes.includes(sample.views) ||
    !inputScenarios.includes(sample.scenario) ||
    sample.state !== 'warm'
  )
    fail('Unknown sample configuration')
  integer(sample.repetition, 'sample repetition')
  const repetitions = result.config.adaptivePairs
    ? result.config.groupRepetitions[`${sample.fixture}/${sample.views}/${sample.scenario}`]
    : result.config.repetitions
  if (sample.repetition >= repetitions) fail('Invalid sample repetition')
  const key = `${sample.fixture}/${sample.views}/${sample.scenario}/${sample.repetition}`
  if (seen.has(key)) fail(`Duplicate sample ${key}`)
  seen.add(key)
  if (sample.fixtureHash !== fixture.sha256) fail(`Fixture hash mismatch ${key}`)
  if (sample.correct !== true) fail(`Failed correctness ${key}`)
  if (result.config.isolation === 'closed-browser-context-per-configuration')
    validateWarmReset(sample, result, fixture)
  else validateCleanup(sample, key)
  validateObservation(sample, result.config)
}

export function validateWarmInputLifecycle(
  result,
  subjects = inputViewModes.flatMap((views) => fixtureIds.map((fixture) => `${fixture}/${views}`)),
) {
  validateInputBootstrap(result)
  const cleanup = result.cleanup
  record(cleanup, 'configuration cleanup')
  same(
    cleanup.beforeListeners,
    result.bootstrap.cleanup.afterListeners,
    'initialized listener baseline',
  )
  same(cleanup.scope, 'configuration', 'cleanup scope')
  text(cleanup.ownerIdentity, 'warm owner identity')
  const warmups = validateWarmupResets(result)
  for (const sample of result.samples) {
    const fixture = result.manifest.fixtures.find((entry) => entry.id === sample.fixture)
    validateWarmReset(sample, result, fixture)
  }
  const reloads = result.samples.concat(warmups).filter((sample) => sample.reset.documentReloaded)
  const editors = subjects.some((subject) => subject.endsWith('/multiple')) ? 3 : 1
  const trackedObjects = (subjects.length + reloads.length) * 2 + editors
  same(cleanup.trackedObjects, trackedObjects, 'tracked configuration objects')
  same(cleanup.retainedObjects, 0, 'retained configuration objects')
  validateCleanup({ cleanup, views: 'multiple' }, 'configuration', cleanup.trackedObjects)
  if (!Array.isArray(result.startup)) fail('Missing warm startup receipts')
  same(
    result.startup.map((entry) => `${entry.fixture}/${entry.views}`).sort(),
    subjects.toSorted(),
    'warm startup coverage',
  )
  for (const [index, entry] of result.startup.entries()) {
    finite(entry.milliseconds, 'startup duration')
    same(entry.ownerIdentity, cleanup.ownerIdentity, 'retained startup owner')
    same(entry.retained, index !== 0, 'warm startup retention')
  }
  same(result.config.warmupFixture, 'measured', 'warm input fixture')
}

function validateWarmupResets(result) {
  if (!Array.isArray(result.warmupResets)) fail('Missing warmup reset receipts')
  const groups = [
    ...new Set(
      result.samples.map((sample) => `${sample.fixture}/${sample.views}/${sample.scenario}`),
    ),
  ]
  const expected = groups.flatMap((group) =>
    Array.from({ length: result.config.warmups }, (_, index) => `${group}/${-index - 1}`),
  )
  same(
    result.warmupResets
      .map((sample) => `${sample.fixture}/${sample.views}/${sample.scenario}/${sample.repetition}`)
      .sort(),
    expected.sort(),
    'warmup reset coverage',
  )
  for (const sample of result.warmupResets) {
    const fixture = result.manifest.fixtures.find((entry) => entry.id === sample.fixture)
    validateWarmReset(sample, result, fixture)
  }
  return result.warmupResets
}

function validateInputBootstrap(result) {
  const bootstrap = result.bootstrap
  record(bootstrap, 'input bootstrap')
  const fixture = result.manifest.fixtures.find((entry) => entry.id === 'ordinary')
  same(bootstrap.fixture, 'ordinary', 'bootstrap fixture')
  same(bootstrap.fixtureHash, fixture.sha256, 'bootstrap fixture hash')
  same(bootstrap.views, 'single', 'bootstrap views')
  same(bootstrap.scenario, 'typing', 'bootstrap scenario')
  same(bootstrap.repetition, -1, 'bootstrap repetition')
  same(bootstrap.correct, true, 'bootstrap correctness')
  finite(bootstrap.wallMs, 'bootstrap duration')
  const cleanup = bootstrap.cleanup
  record(cleanup, 'bootstrap cleanup')
  for (const [key, expected] of Object.entries({
    active: false,
    hosts: 0,
    pendingFrames: 0,
    retainedObjects: 0,
    trackedObjects: 3,
    contextClosed: true,
  }))
    same(cleanup[key], expected, `bootstrap cleanup ${key}`)
  if (cleanup.liveWorkers !== undefined) same(cleanup.liveWorkers, 0, 'bootstrap workers')
  integer(cleanup.beforeListeners, 'bootstrap listener count before disposal')
  integer(cleanup.afterListeners, 'bootstrap listener count after disposal')
  validateObservation(bootstrap, result.config)
}

function validateWarmReset(sample, result, fixture) {
  const reset = sample.reset
  record(reset, 'input reset')
  same(reset.ownerIdentity, result.cleanup.ownerIdentity, 'retained input owner')
  same(reset.fixtureHash, fixture.sha256, 'reset fixture')
  same(reset.length, fixture.normalizedLength, 'reset text length')
  same(reset.views, sample.views === 'multiple' ? 3 : 1, 'reset views')
  same(reset.hiddenViews, sample.views === 'multiple' ? 1 : 0, 'reset hidden views')
  same(reset.cursor, { row: 0, column: 0 }, 'reset cursor')
  same(reset.historyEmpty, true, 'reset history')
  same(reset.sourceCurrent, true, 'reset consumer source')
  finite(reset.milliseconds, 'reset duration')
  if (typeof reset.documentReloaded !== 'boolean') fail('Missing document reload receipt')
  if (
    reset.documentReloaded &&
    !(
      result.config.pendingMinimapSource &&
      sample.fixture === 'short-lines' &&
      sample.scenario === 'undo'
    )
  )
    fail('Unadmitted reset document reload')
  if (
    reset.documentReloaded &&
    (!Array.isArray(reset.rejectedSource) ||
      !reset.rejectedSource.some((source) => source.current === false))
  )
    fail('Document reload requires a rejected source receipt')
  if (!reset.documentReloaded && reset.rejectedSource !== null)
    fail('Unexpected rejected reset source')
  if (sample.cleanup !== null) fail('Warm bursts must use configuration cleanup')
}

function validateCleanup(sample, key, trackedOverride = null) {
  record(sample.cleanup, `cleanup ${key}`)
  const cleanup = sample.cleanup
  const trackedObjects = trackedOverride ?? (sample.views === 'multiple' ? 5 : 3)
  if (
    cleanup.active !== false ||
    cleanup.hosts !== 0 ||
    cleanup.pendingFrames !== 0 ||
    (cleanup.liveWorkers !== undefined && cleanup.liveWorkers !== 0) ||
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
  return Object.fromEntries(
    Array.from(groups(result), ([key, values]) => [key, distribution(values)]),
  )
}

export function assertInputComparable(left, right, allowSlowdown = false) {
  validateInputResult(left)
  validateInputResult(right)
  same(left.manifest, right.manifest, 'fixture manifests/hashes')
  const candidateConfig = allowSlowdown
    ? {
        ...right.config,
        slowdownMs: left.config.slowdownMs,
        frameSlowdownMs: left.config.frameSlowdownMs,
      }
    : right.config
  same(left.config, candidateConfig, 'workload options or repetitions')
  same(left.environment.browser, right.environment.browser, 'browser')
  same(left.environment.hardware, right.environment.hardware, 'hardware')
  same(left.environment.runtime, right.environment.runtime, 'runner runtime')
  same(
    left.environment.instrumentExternal,
    right.environment.instrumentExternal,
    'instrument external dependencies',
  )
  same(left.environment.instrumentHash, right.environment.instrumentHash, 'instrument source')
}
