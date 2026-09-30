import { writeFile } from 'node:fs/promises'
import { readInputArtifact, writeInputArtifact } from '../input-artifacts.mjs'
import { resolve } from 'node:path'
import {
  calibrateInput,
  compareInput,
  summarizeInputResult,
  validateInputResult,
} from '../input-results.mjs'
import { fail } from '../errors.mjs'
import { verifyRangeIndexes } from '../input-range-indexes.mjs'

const directory = resolve(process.argv[2] ?? 'examples/stress/results/input-latency')
const read = (name) => readInputArtifact(resolve(directory, name + '.json.gz'))
const controls = await Promise.all(['control-1', 'control-2', 'control-3'].map(read))
const [rerun, candidate, delayed, diagnostic] = await Promise.all(
  ['rerun', 'candidate', 'delayed', 'diagnostic'].map(read),
)
const runs = [...controls, rerun, candidate, delayed, diagnostic]
if (new Set(runs.map((run) => run.id)).size !== runs.length)
  fail('Input proof requires distinct control, holdout, candidate, delayed and diagnostic runs')
if (rerun.environment.sourceHash !== controls[0].environment.sourceHash)
  fail('Reference holdout must use the unchanged control source')
if (delayed.environment.sourceHash !== candidate.environment.sourceHash)
  fail('Delayed control source differs from candidate')
const calibration = calibrateInput(controls)
const holdout = compareInput(controls[0], rerun, calibration)
const candidateResult = compareInput(controls[0], candidate, calibration)
const positive = compareInput(controls[0], delayed, calibration, { allowSlowdown: true })
if (candidate.config.diagnostics || candidate.config.slowdownMs !== 0)
  fail('Invalid production candidate')
validateInputResult(diagnostic)
if (diagnostic.environment.sourceHash !== candidate.environment.sourceHash)
  fail('Diagnostic source differs from candidate')
if (JSON.stringify(diagnostic.manifest) !== JSON.stringify(candidate.manifest))
  fail('Diagnostic fixtures differ')
if (
  JSON.stringify(diagnostic.environment.browser) !==
    JSON.stringify(candidate.environment.browser) ||
  JSON.stringify(diagnostic.environment.hardware) !== JSON.stringify(candidate.environment.hardware)
)
  fail('Diagnostic environment differs')
const {
  repetitions: _diagnosticRepetitions,
  diagnostics: _diagnosticEnabled,
  ...diagnosticConfig
} = diagnostic.config
const {
  repetitions: _productionRepetitions,
  diagnostics: _productionEnabled,
  ...productionConfig
} = candidate.config
if (
  JSON.stringify(diagnosticConfig) !== JSON.stringify(productionConfig) ||
  diagnostic.environment.runtime !== candidate.environment.runtime
)
  fail('Diagnostic workload or runtime differs')
if (!diagnostic.config.diagnostics || diagnostic.config.slowdownMs !== 0)
  fail('Invalid diagnostic control')
if (!holdout.passed) fail('Independent unchanged rerun exceeded the calibrated budget')
if (positive.passed) fail('Real delayed input control escaped the calibrated budget')
const delayedDispatch = positive.metrics.filter((metric) => metric.key.endsWith('/dispatch'))
if (delayedDispatch.length !== 36 || delayedDispatch.some((metric) => metric.passed))
  fail('Delayed control must fail every synchronous input group')
const measured = summarizeInputResult(candidate)
const before = await read('before')
validateInputResult(before)
const { repetitions: _beforeRepetitions, ...beforeConfig } = before.config
const { repetitions: _afterRepetitions, ...afterConfig } = candidate.config
if (
  before.environment.runtime !== candidate.environment.runtime ||
  JSON.stringify(beforeConfig) !== JSON.stringify(afterConfig) ||
  JSON.stringify(before.manifest) !== JSON.stringify(candidate.manifest) ||
  JSON.stringify(before.environment.hardware) !== JSON.stringify(candidate.environment.hardware) ||
  JSON.stringify(before.environment.browser) !== JSON.stringify(candidate.environment.browser)
)
  fail('Before/after workload differs')
const delayedSummary = summarizeInputResult(delayed)
const report = {
  schemaVersion: 1,
  reference: candidate.environment,
  sourceHash: candidate.environment.sourceHash,
  controlSourceHash: controls[0].environment.sourceHash,
  controlIds: controls.map((control) => control.id),
  referenceHoldout: holdout,
  candidate: candidateResult,
  candidateFailures: exceededMetrics(candidateResult, true),
  candidateAdvisories: exceededMetrics(candidateResult, false),
  positiveControl: positive,
  distributions: measured,
  before: { environment: before.environment, distributions: summarizeInputResult(before) },
  delayedDistributions: delayedSummary,
  inputEvents: runs.reduce(
    (total, run) =>
      total + run.samples.reduce((count, sample) => count + sample.observation.events.length, 0),
    0,
  ),
  diagnosticRunId: diagnostic.id,
  diagnosticPhases: phases(diagnostic),
  rangeIndexEvidence: verifyRangeIndexes(diagnostic),
  diagnosticsOverhead: overhead(candidate, diagnostic),
  passed: candidateResult.passed,
}
await writeInputArtifact(resolve(directory, 'calibration.json.gz'), calibration)
await writeFile(resolve(directory, 'verification.json'), JSON.stringify(report, null, 2) + '\n')
console.log(
  JSON.stringify({
    event: 'input.proof',
    passed: report.passed,
    candidateFailures: report.candidateFailures,
    candidateAdvisories: report.candidateAdvisories,
    directory,
  }),
)
if (!report.passed) process.exitCode = 1

function exceededMetrics(comparison, blocking) {
  return comparison.metrics
    .filter((metric) => metric.blocking === blocking && !metric.passed)
    .map((metric) => ({
      key: metric.key,
      p95Ms: metric.p95Ms,
      limitMs: metric.limit.p95Ms,
      excessMs: metric.p95Ms - metric.limit.p95Ms,
    }))
}

function distribution(values) {
  const sorted = values.toSorted((a, b) => a - b)
  const at = (fraction) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
  return { count: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.at(-1) }
}

function phases(result) {
  const groups = new Map()
  for (const sample of result.samples) collectPhases(groups, sample)
  return Object.fromEntries([...groups].map(([key, values]) => [key, distribution(values)]))
}

function collectPhases(groups, sample) {
  const operations = new Set(sample.observation.correlations.map((entry) => entry.operation.id))
  for (const event of sample.observation.diagnostics) {
    if (!operations.has(event.operation?.id) || event.durationMs === undefined) continue
    const key = `${sample.fixture}/${sample.views}/${sample.scenario}/${event.name}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(event.durationMs)
  }
}

function overhead(production, diagnostic) {
  const collect = (result) => {
    const groups = new Map()
    for (const sample of result.samples) {
      const key = `${sample.fixture}/${sample.views}/${sample.scenario}`
      groups.set(key, [...(groups.get(key) ?? []), ...sample.latencyMs.dispatch])
    }
    return groups
  }
  const plain = collect(production)
  return Object.fromEntries(
    [...collect(diagnostic)].map(([key, values]) => {
      const baseline = distribution(plain.get(key))
      const instrumented = distribution(values)
      return [
        key,
        {
          production: baseline,
          instrumented,
          p50DeltaMs: instrumented.p50 - baseline.p50,
          p95DeltaMs: instrumented.p95 - baseline.p95,
        },
      ]
    }),
  )
}
