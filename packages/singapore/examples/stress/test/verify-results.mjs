import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { calibrate, compare, validateResult } from '../results.mjs'
import { fail } from '../errors.mjs'

const directory = resolve(process.argv[2] ?? 'results')
const read = async (name) => JSON.parse(await readFile(resolve(directory, name), 'utf8'))
const limits = await read('calibration.json')
const controls = await Promise.all(
  Array.from({ length: limits.controls.length }, (_, index) => read(`control-${index + 1}.json`)),
)
const rerun = await read('rerun.json')
if (JSON.stringify(calibrate(controls)) !== JSON.stringify(limits))
  fail('Checked tolerances differ from recorded controls')
const comparison = compare(controls[0], rerun, limits)
if (controls.some((control) => control.id === rerun.id))
  fail('Rerun must be independent of the controls')
if (controls[0].cancellation?.passed !== true) fail('Missing live cancellation evidence')

if (!comparison.metrics.find((metric) => metric.key === 'ordinary/open/cold/attach')?.passed)
  fail('Slowdown probe needs an unchanged passing metric')
const slow = structuredClone(rerun)
for (const sample of slow.samples) {
  if (sample.scenario !== 'open' || sample.fixture !== 'ordinary') continue
  sample.latencyMs.attach = sample.latencyMs.attach.map((value) => value + 10_000)
}
const slowdown = compare(controls[0], slow, limits)
if (
  !slowdown.metrics.some((metric) => metric.key === 'ordinary/open/cold/attach' && !metric.passed)
)
  fail('Injected timing slowdown went undetected')

const retained = structuredClone(rerun)
retained.samples[0].memory.after.usedBytes += 1_000_000_000
retained.samples[0].memory.after.totalBytes += 1_000_000_000
if (
  !compare(controls[0], retained, limits).resources.some(
    (metric) => metric.key === 'ordinary/open/cold/heapBytes' && !metric.passed,
  )
)
  fail('Injected memory retention went undetected')
const missing = structuredClone(rerun)
missing.samples.pop()
expectRejected(() => validateResult(missing), 'missing samples')
const hash = structuredClone(rerun)
hash.samples[0].fixtureHash = '0'.repeat(64)
expectRejected(() => compare(controls[0], hash, limits), 'fixture hashes')
const options = structuredClone(rerun)
options.config.diagnostics = !options.config.diagnostics
expectRejected(() => compare(controls[0], options, limits), 'feature options')
const missingChurnMemory = structuredClone(rerun)
delete churnSample(missingChurnMemory).memory.postChurn
expectRejected(() => validateResult(missingChurnMemory), 'missing post-churn memory')
const partialMemory = structuredClone(rerun)
churnSample(partialMemory).memory = { status: 'unsupported', reason: 'deliberate missing sample' }
expectRejected(() => compare(controls[0], partialMemory, limits), 'partial memory coverage')
const missingRetention = structuredClone(rerun)
delete missingRetention.samples[0].cleanup.retainedObjects
expectRejected(() => validateResult(missingRetention), 'missing retained-object count')

console.log(
  JSON.stringify(
    {
      contractsPassed: true,
      calibrationStable: comparison.passed,
      controls: controls.map((control) => control.id),
      rerun: rerun.id,
      samplesPerRun: rerun.samples.length,
      latencyComparisons: comparison.metrics.length,
      resourceComparisons: comparison.resources.length,
      liveCancellation: controls[0].cancellation,
      injectedSlowdown: {
        kind: 'synthetic addition to recorded raw attach samples',
        addedMs: 10_000,
        detected: slowdown.metrics
          .filter(
            (metric) =>
              !metric.passed &&
              metric.key.startsWith('ordinary/open/') &&
              metric.key.endsWith('/attach'),
          )
          .map((metric) => metric.key),
      },
      injectedRetentionDetected: true,
      missingSamplesRejected: true,
      fixtureHashesRejected: true,
      differentOptionsRejected: true,
      missingPostChurnMemoryRejected: true,
      partialMemoryCoverageRejected: true,
      missingRetainedObjectsRejected: true,
      initialControlCheck: initialControlCheck(),
      unchangedComparison: {
        failedLatencyLimits: comparison.metrics.filter((metric) => !metric.passed),
        failedResourceLimits: comparison.resources.filter((metric) => !metric.passed),
      },
    },
    null,
    2,
  ),
)

function churnSample(result) {
  const sample = result.samples.find(
    (entry) => entry.fixture === 'ordinary' && entry.scenario === 'churn' && entry.state === 'cold',
  )
  if (!sample) fail('Memory probes require an ordinary cold churn sample')
  return sample
}

function initialControlCheck() {
  if (controls.length < 4) return null
  const initial = compare(controls[0], controls[3], calibrate(controls.slice(0, 3)))
  return {
    candidate: controls[3].id,
    passed: initial.passed,
    failedLatencyLimits: initial.metrics.filter((metric) => !metric.passed).length,
    failedResourceLimits: initial.resources.filter((metric) => !metric.passed).length,
  }
}

function expectRejected(run, label) {
  try {
    run()
  } catch {
    return
  }
  fail(`Did not reject ${label}`)
}
