import { fail } from './errors.ts'
import {
  correlateInputEvents,
  validateDiagnostic,
  type CorrelationDiagnostic,
  type CorrelationEvent,
  type InputCorrelation,
  type Operation,
} from './input-correlation.ts'
import type { InputScenario } from './src/inputLatency.ts'

export const inputScenarios: readonly InputScenario[] = Object.freeze([
  'typing',
  'repeat',
  'composition-update',
  'composition-commit',
  'paste',
  'undo',
])
export function isInputScenario(value: unknown): value is InputScenario {
  return typeof value === 'string' && inputScenarios.some((scenario) => scenario === value)
}
export const inputViewModes = Object.freeze(['single', 'multiple'])
const fixtureIds = ['ordinary', 'short-lines', 'long-line']
const metrics = ['inputToApplied', 'dispatch', 'inputToFrame', 'burstToPaintUpperBound']
const timingEpsilonMs = 0.000001
const formula =
  'max(control p95) + max(3 * range(control p95), 3 * range(control p50), max(control max - control min))'

export interface InputFixture {
  id: string
  sha256: string
  bytes: number
  utf16Length: number
  normalizedLength: number
  lines: number
  longestLine: number
  searchCount: number
}
export interface InputManifest {
  schemaVersion: number
  generatorVersion: number
  seed: number
  fixtures: InputFixture[]
}
export interface InputConfig {
  repetitions: number
  warmups: number
  scenarios: readonly string[]
  views: readonly string[]
  compositionCommitTrust: string
  isolation: string
  diagnostics: boolean
  slowdownMs: number
  operationsPerSample: Record<string, number>
}
export interface InputEnvironment {
  commit: string
  sourceHash: string
  dirty: boolean
  browser: { engine: string; version: string; headless: boolean }
  hardware: {
    cpu: string
    architecture: string
    platform: string
    release: string
    logicalCpus: number
    memoryBytes: number
  }
  runtime: string
}
export interface InputEvent extends CorrelationEvent {
  at: number
  appliedAt: number
  frameAt: number
  trusted: boolean
  repeat: boolean
  eventType: string
  inputType: string
}
export interface InputPaint {
  method: string
  imageChanged: boolean
  startedAt: number
  completedAt: number
  revision: number
  operation: Operation | null
}
export interface RenderedView {
  view: number
  hidden: boolean
  verifiedText: boolean
  rows: number
  chunks: number
}
export interface InputObservation {
  events: InputEvent[]
  paint: InputPaint
  rendered: RenderedView[]
  revision: number
  diagnostics: CorrelationDiagnostic[]
  droppedDiagnostics: number
  correlations: InputCorrelation[] | null
}
export interface InputCleanup {
  active: boolean
  hosts: number
  pendingFrames: number
  contextClosed: boolean
  trackedObjects: number
  retainedObjects: number
  beforeListeners: number
  afterListeners: number
}
export interface InputLatency {
  inputToApplied: number[]
  dispatch: number[]
  inputToFrame: number[]
  burstToPaintUpperBound: number[]
  [metric: string]: number[]
}
export interface InputSample {
  fixture: string
  fixtureHash: string
  views: string
  scenario: string
  state: string
  repetition: number
  correct: boolean
  cleanup: InputCleanup
  latencyMs: InputLatency
  observation: InputObservation
}
export interface InputResult {
  schemaVersion: number
  suite: string
  id: string
  smokeOnly?: boolean
  environment: InputEnvironment
  manifest: InputManifest
  config: InputConfig
  samples: InputSample[]
}
type ObservationContext = Pick<InputSample, 'scenario' | 'views' | 'fixture' | 'latencyMs'>

function record(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`Missing ${label}`)
}
function array(value: unknown): value is unknown[] {
  return Array.isArray(value)
}
function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) fail(`Missing ${label}`)
}
function integer(value: unknown, label: string, minimum = 0): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum)
    fail(`Invalid ${label}`)
}
function finite(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(`Invalid ${label}`)
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(Reflect.get(value, key))]),
  )
}
function same(left: unknown, right: unknown, label: string) {
  if (JSON.stringify(canonical(left)) !== JSON.stringify(canonical(right)))
    fail(`Incomparable ${label}`)
}
function keys(
  value: unknown,
  expected: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  record(value, label)
  same(Object.keys(value).sort(), expected.toSorted(), `${label} coverage`)
}
function hash(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail(`Invalid ${label}`)
}
function validateEnvironment(environment: unknown): asserts environment is InputEnvironment {
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
function validateManifest(manifest: unknown): asserts manifest is InputManifest {
  record(manifest, 'fixture manifest')
  if (manifest.schemaVersion !== 1 || !array(manifest.fixtures)) fail('Missing fixture manifest')
  integer(manifest.generatorVersion, 'fixture generator version', 1)
  integer(manifest.seed, 'fixture seed')
  for (const fixture of manifest.fixtures) validateFixture(fixture)
  same(
    manifest.fixtures
      .map((fixture) => {
        record(fixture, 'fixture')
        return fixture.id
      })
      .sort(),
    fixtureIds.toSorted(),
    'fixture',
  )
}
function validateFixture(fixture: unknown): asserts fixture is InputFixture {
  record(fixture, 'fixture')
  text(fixture.id, 'fixture id')
  hash(fixture.sha256, 'fixture hash')
  for (const field of ['bytes', 'utf16Length', 'normalizedLength', 'lines', 'longestLine'])
    integer(fixture[field], `fixture ${field}`, 1)
  integer(fixture.searchCount, 'fixture search count')
}
export function validateInputConfig(config: unknown): asserts config is InputConfig {
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
export function validateInputResult(result: unknown): InputResult {
  assertInputResult(result)
  return result
}
function assertInputResult(result: unknown): asserts result is InputResult {
  record(result, 'input-latency result')
  if (result.schemaVersion !== 1 || result.suite !== 'input-latency' || !array(result.samples))
    fail('Unsupported input-latency result schema')
  if (result.smokeOnly !== undefined && result.smokeOnly !== false)
    fail('Smoke-only results cannot establish an input latency budget')
  text(result.id, 'run id')
  validateEnvironment(result.environment)
  validateManifest(result.manifest)
  validateInputConfig(result.config)
  const seen = new Set<string>()
  for (const sample of result.samples)
    validateSample(sample, { manifest: result.manifest, config: result.config }, seen)
  const expected =
    fixtureIds.length * inputViewModes.length * inputScenarios.length * result.config.repetitions
  if (seen.size !== expected) fail(`Missing samples: expected ${expected}, got ${seen.size}`)
}
function validateSample(
  sample: unknown,
  result: Pick<InputResult, 'manifest' | 'config'>,
  seen: Set<string>,
): asserts sample is InputSample {
  record(sample, 'sample')
  const fixture = result.manifest.fixtures.find((entry) => entry.id === sample.fixture)
  if (
    !fixture ||
    typeof sample.fixture !== 'string' ||
    typeof sample.views !== 'string' ||
    !inputViewModes.includes(sample.views) ||
    typeof sample.scenario !== 'string' ||
    !inputScenarios.some((scenario) => scenario === sample.scenario) ||
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
  validateCleanup(sample.cleanup, sample.views, key)
  validateLatency(sample.latencyMs, result.config.operationsPerSample[sample.scenario])
  validateObservation(
    sample.observation,
    {
      scenario: sample.scenario,
      fixture: sample.fixture,
      views: sample.views,
      latencyMs: sample.latencyMs,
    },
    result.config,
  )
}
function validateCleanup(
  cleanup: unknown,
  views: string,
  key: string,
): asserts cleanup is InputCleanup {
  record(cleanup, `cleanup ${key}`)
  const trackedObjects = views === 'multiple' ? 4 : 2
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
function validateLatency(latency: unknown, count: number): asserts latency is InputLatency {
  keys(latency, metrics, 'latency')
  for (const metric of metrics) {
    const expected = metric === 'burstToPaintUpperBound' ? 1 : count
    const values = latency[metric]
    if (!array(values) || values.length !== expected) fail(`Missing ${metric} samples`)
    for (const value of values) finite(value, `${metric} raw latency`)
  }
}
function validateObservation(
  observation: unknown,
  context: ObservationContext,
  config: InputConfig,
): asserts observation is InputObservation {
  record(observation, 'input observation')
  const count = config.operationsPerSample[context.scenario]
  if (!array(observation.events) || observation.events.length !== count)
    fail('Missing per-operation event observations')
  validateEvents(observation.events, context)
  validatePaint(observation.paint, observation.events, observation.revision, context.latencyMs)
  validateRenderedViews(observation.rendered, context.views)
  validateDiagnostics(observation, observation.events, observation.paint, context, config)
}
function validateEvents(
  events: unknown[],
  context: ObservationContext,
): asserts events is InputEvent[] {
  const seen = new Set<number>()
  let previous: InputEvent | undefined
  for (const [index, event] of events.entries()) {
    validateEvent(event, context, index, seen, previous)
    previous = event
  }
}
function validateEvent(
  event: unknown,
  context: ObservationContext,
  index: number,
  seen: Set<number>,
  previous: InputEvent | undefined,
): asserts event is InputEvent {
  record(event, 'input event')
  integer(event.id, 'operation id', 1)
  if (seen.has(event.id)) fail('Duplicate operation id')
  seen.add(event.id)
  const expectedTrust = context.scenario !== 'composition-commit'
  if (event.trusted !== expectedTrust)
    fail('Untrusted input observation or mislabeled CDP composition commit')
  text(event.eventType, 'event type')
  if (typeof event.inputType !== 'string' || typeof event.repeat !== 'boolean')
    fail('Missing input event semantics')
  validateEventSemantics(context.scenario, event.eventType, event.inputType, event.repeat, index)
  finite(event.at, 'event at')
  finite(event.dispatchAt, 'event dispatchAt')
  finite(event.completedAt, 'event completedAt')
  finite(event.appliedAt, 'event appliedAt')
  finite(event.frameAt, 'event frameAt')
  if (
    event.at > event.dispatchAt ||
    event.dispatchAt > event.appliedAt ||
    event.appliedAt > event.completedAt ||
    event.completedAt > event.frameAt
  )
    fail('Invalid event phase ordering')
  integer(event.revisionBefore, 'revision before')
  integer(event.revisionAfter, 'revision after')
  if (context.scenario === 'composition-update' && event.revisionAfter !== event.revisionBefore)
    fail('Composition preedit changed the document revision')
  if (context.scenario === 'composition-update')
    exactLatency(event.appliedAt, event.completedAt, 'composition preedit completion')
  if (context.scenario !== 'composition-update' && event.revisionAfter <= event.revisionBefore)
    fail('Input did not commit a new document revision')
  if (previous && event.revisionBefore !== previous.revisionAfter)
    fail('Disconnected operation revisions')
  if (previous && event.at < previous.at) fail('Input observations are out of order')
  exactLatency(
    context.latencyMs.inputToApplied[index],
    event.appliedAt - event.at,
    'inputToApplied',
  )
  exactLatency(context.latencyMs.dispatch[index], event.completedAt - event.dispatchAt, 'dispatch')
  exactLatency(context.latencyMs.inputToFrame[index], event.frameAt - event.at, 'inputToFrame')
}
function validateEventSemantics(
  scenario: string,
  eventType: string,
  inputType: string,
  repeat: boolean,
  index: number,
) {
  const eventTypes: Record<string, string[]> = {
    typing: ['beforeinput', 'insertText'],
    repeat: ['beforeinput', 'insertText'],
    'composition-update': ['compositionupdate', 'compositionupdate'],
    'composition-commit': ['compositionend', 'compositionend'],
    paste: ['paste', 'paste'],
    undo: ['keydown', 'keydown'],
  }
  same([eventType, inputType], eventTypes[scenario], `${scenario} event semantics`)
  if (scenario === 'repeat' && index > 0 && !repeat) fail('Missing native key repeat')
}
function exactLatency(actual: number, expected: number, label: string) {
  if (Math.abs(actual - expected) > timingEpsilonMs) fail(`Latency disagrees with event ${label}`)
}
function validatePaint(
  paint: unknown,
  events: InputEvent[],
  revision: unknown,
  latency: InputLatency,
): asserts paint is Omit<InputPaint, 'operation'> & { operation?: unknown } {
  record(paint, 'screenshot paint observation')
  if (paint.method !== 'screenshot-completion-upper-bound')
    fail('Missing screenshot paint observation')
  if (paint.imageChanged !== true) fail('Screenshot has missing or unchanged pixels')
  finite(paint.startedAt, 'screenshot start')
  finite(paint.completedAt, 'screenshot completion')
  const last = events[events.length - 1]
  same(revision, last.revisionAfter, 'final observed revision')
  same(paint.revision, last.revisionAfter, 'paint revision')
  const completedAt = paint.completedAt
  if (
    paint.startedAt < last.completedAt ||
    paint.completedAt < paint.startedAt ||
    events.some((event) => event.frameAt > completedAt)
  )
    fail('Invalid screenshot phase ordering')
  exactLatency(
    latency.burstToPaintUpperBound[0],
    paint.completedAt - events[0].at,
    'burstToPaintUpperBound',
  )
}
function validateRenderedViews(
  rendered: unknown,
  views: string,
): asserts rendered is RenderedView[] {
  const count = views === 'multiple' ? 3 : 1
  if (!array(rendered) || rendered.length !== count) fail('Missing rendered view observations')
  for (const [index, view] of rendered.entries()) {
    record(view, 'rendered view')
    if (view.view !== index || view.hidden !== false || view.verifiedText !== true)
      fail('Invalid rendered view correctness')
    integer(view.rows, 'rendered row count', 1)
    integer(view.chunks, 'rendered chunk count', 1)
  }
}
function validateDiagnostics(
  observation: Record<string, unknown>,
  events: InputEvent[],
  paint: { operation?: unknown; revision: number },
  context: ObservationContext,
  config: InputConfig,
) {
  if (observation.droppedDiagnostics !== 0) fail('Dropped diagnostic observations')
  if (!array(observation.diagnostics)) fail('Missing diagnostic timeline')
  if (!config.diagnostics) {
    if (observation.diagnostics.length) fail('Disabled diagnostics emitted observations')
    same(observation.correlations, null, 'disabled diagnostic correlations')
    same(paint.operation, null, 'disabled paint operation')
    return
  }
  for (const diagnostic of observation.diagnostics) validateDiagnostic(diagnostic)
  const correlations = correlateInputEvents({
    events,
    diagnostics: observation.diagnostics,
    scenario: context.scenario,
    views: context.views,
    documentId: context.fixture,
  })
  same(observation.correlations, correlations, 'input diagnostic correlations')
  const last = correlations[correlations.length - 1]
  same(paint.operation, last.operation, 'paint operation')
  same(paint.revision, last.revision, 'paint operation revision')
}
function percentile(sorted: readonly number[], fraction: number) {
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
}

function distribution(rawSamples: number[]) {
  const sorted = rawSamples.toSorted((left: number, right: number) => left - right)
  return {
    count: sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: sorted[sorted.length - 1],
    rawSamples,
  }
}

function groups(result: InputResult) {
  const grouped = new Map<string, number[]>()
  for (const sample of result.samples) addGroups(grouped, sample)
  return grouped
}

function addGroups(grouped: Map<string, number[]>, sample: InputSample) {
  for (const [metric, values] of Object.entries(sample.latencyMs)) {
    const key = `${sample.fixture}/${sample.views}/${sample.scenario}/${metric}`
    const existing = grouped.get(key) ?? []
    existing.push(...values)
    grouped.set(key, existing)
  }
}

export function summarizeInputResult(result: unknown) {
  const verified = validateInputResult(result)
  return Object.fromEntries(
    [...groups(verified)].map(([key, values]) => [key, distribution(values)]),
  )
}

function comparable(left: InputResult, right: InputResult, allowSlowdown = false) {
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

function range(values: readonly number[]) {
  return Math.max(...values) - Math.min(...values)
}

function controlLimit(summaries: ReturnType<typeof summarizeInputResult>[], key: string) {
  const controlP50Ms = summaries.map((summary) => summary[key].p50Ms)
  const controlP95Ms = summaries.map((summary) => summary[key].p95Ms)
  const controlMinMs = summaries.map((summary) => Math.min(...summary[key].rawSamples))
  const controlMaxMs = summaries.map((summary) => summary[key].maxMs)
  const noiseMarginMs = Math.max(
    3 * range(controlP95Ms),
    3 * range(controlP50Ms),
    ...controlMaxMs.map((value: number, index: number) => value - controlMinMs[index]),
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

function validateControls(input: readonly unknown[]): asserts input is readonly InputResult[] {
  for (const control of input) assertInputResult(control)
}
export function calibrateInput(input: readonly unknown[]) {
  validateControls(input)
  const controls = input
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
    controlRuns: input,
    limits: Object.fromEntries(
      Object.keys(summaries[0]).map((key) => [key, controlLimit(summaries, key)]),
    ),
  }
}

function validateCalibration(
  baseline: InputResult,
  calibration: unknown,
): asserts calibration is InputCalibration {
  record(calibration, 'input-latency calibration')
  if (
    calibration.schemaVersion !== 1 ||
    calibration.suite !== 'input-latency' ||
    !array(calibration.controlRuns)
  )
    fail('Unsupported input-latency calibration schema')
  same(
    calibration,
    calibrateInput(calibration.controlRuns),
    'calibration derived from raw controls',
  )
  const storedBaseline = calibration.controlRuns
    .map(validateInputResult)
    .find((control) => control.id === baseline.id)
  if (!storedBaseline) fail('Calibration does not identify this baseline')
  same(baseline, storedBaseline, 'calibration baseline observations')
}

export function compareInput(
  baselineValue: unknown,
  candidateValue: unknown,
  calibration: unknown,
  { allowSlowdown = false } = {},
) {
  const baseline = validateInputResult(baselineValue)
  const candidate = validateInputResult(candidateValue)
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

export type InputCalibration = ReturnType<typeof calibrateInput>
export type InputComparison = ReturnType<typeof compareInput>
