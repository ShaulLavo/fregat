import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(
  process.argv[2] ?? fileURLToPath(new URL('../results/first-paint/', import.meta.url)),
)
const read = async (name) => JSON.parse(await readFile(resolve(root, name + '.json')))
const before = await read('before')
const control = await read('control')
const after = await read('after')
const diagnosticBefore = await read('diagnostic-before')
const diagnosticAfter = await read('diagnostic-after')
const ordinaryBefore = await read('ordinary-before-holdout')
const ordinaryAfter = await read('ordinary-after-holdout')
const cleanupProbe = await read('cleanup-probe')
const identity = (sample) => [sample.fixture, sample.mode, sample.plugin, sample.state].join('/')
const percentile = (values, fraction) =>
  values.toSorted((a, b) => a - b)[Math.ceil(values.length * fraction) - 1]
const summarize = (values) => ({
  minimum: Math.min(...values),
  median: percentile(values, 0.5),
  p95: percentile(values, 0.95),
  maximum: Math.max(...values),
})
function validate(result) {
  assert.equal(result.suite, 'first-paint')
  assert.ok(Number.isInteger(result.config.repetitions) && result.config.repetitions > 0)
  const expected =
    result.manifest.fixtures.length *
    result.config.modes.length *
    result.config.plugins.length *
    result.config.states.length *
    result.config.repetitions
  assert.equal(result.samples.length, expected)
  assert.equal(new Set(result.samples.map((s) => identity(s) + '/' + s.repetition)).size, expected)
  for (const sample of result.samples) {
    assert.ok(result.config.modes.includes(sample.mode))
    assert.ok(result.config.plugins.includes(sample.plugin))
    assert.ok(result.config.states.includes(sample.state))
    assert.ok(
      Number.isInteger(sample.repetition) &&
        sample.repetition >= 0 &&
        sample.repetition < result.config.repetitions,
    )
    assert.equal(sample.correct, true)
    assert.equal(
      sample.fixtureHash,
      result.manifest.fixtures.find((f) => f.id === sample.fixture).sha256,
    )
    assert.equal(sample.observation.correctText, true)
    assert.equal(sample.observation.revision, 0)
    assert.equal(sample.cleanup.retainedObjects, 0)
    assert.equal(sample.cleanup.hosts, 0)
    assert.equal(sample.cleanup.active, false)
    if (sample.cleanup.worker) assert.equal(sample.cleanup.worker.pendingRequests, 0)
    assert.ok(sample.pixels.text.ink >= 20)
    if (sample.plugin === 'tree-sitter') assert.ok(sample.pixels.highlighted.chromatic >= 20)
    if (sample.plugin === 'tree-sitter' && sample.mode === 'prepared') {
      assert.ok(sample.pixels.text.chromatic >= 20)
      assert.ok(sample.latencyMs.highlightCallback <= sample.latencyMs.visibleTextUpperBound)
    }
    for (const value of Object.values(sample.latencyMs))
      assert.ok(Number.isFinite(value) && value >= 0)
  }
}
const runs = [
  before,
  control,
  after,
  diagnosticBefore,
  diagnosticAfter,
  ordinaryBefore,
  ordinaryAfter,
  cleanupProbe,
]
for (const result of runs) validate(result)
assert.equal(new Set(runs.map((result) => result.id)).size, runs.length)
for (const result of [control, after]) {
  assert.deepEqual(result.config, before.config)
  assert.deepEqual(result.manifest, before.manifest)
  for (const field of ['browser', 'runtime', 'hardware'])
    assert.deepEqual(result.environment[field], before.environment[field])
}
assert.equal(before.environment.sourceHash, control.environment.sourceHash)
assert.equal(before.environment.sourceHash, diagnosticBefore.environment.sourceHash)
assert.equal(after.environment.sourceHash, diagnosticAfter.environment.sourceHash)
assert.deepEqual({ ...diagnosticBefore.config, diagnostics: false, repetitions: 3 }, before.config)
assert.deepEqual({ ...diagnosticAfter.config, diagnostics: false, repetitions: 3 }, after.config)
assert.deepEqual(ordinaryBefore.config, ordinaryAfter.config)
assert.deepEqual(ordinaryBefore.manifest, ordinaryAfter.manifest)
assert.equal(ordinaryBefore.environment.sourceHash, before.environment.sourceHash)
assert.equal(ordinaryAfter.environment.sourceHash, after.environment.sourceHash)
assert.equal(cleanupProbe.environment.sourceHash, after.environment.sourceHash)
for (const result of [
  diagnosticBefore,
  diagnosticAfter,
  ordinaryBefore,
  ordinaryAfter,
  cleanupProbe,
])
  for (const field of ['browser', 'runtime', 'hardware'])
    assert.deepEqual(result.environment[field], before.environment[field])
assert.throws(() => validate({ ...before, samples: before.samples.slice(1) }))
assert.throws(() =>
  validate({ ...before, samples: [before.samples[0], ...before.samples.slice(0, -1)] }),
)
assert.throws(() =>
  validate({
    ...before,
    samples: [{ ...before.samples[0], state: 'missing-group' }, ...before.samples.slice(1)],
  }),
)
assert.throws(() =>
  validate({
    ...before,
    manifest: {
      ...before.manifest,
      fixtures: before.manifest.fixtures.map((fixture) => ({ ...fixture, sha256: 'wrong' })),
    },
  }),
)
const keys = [...new Set(before.samples.map(identity))]
function metricValue(sample, metric) {
  if (metric !== 'firstHighlightedCaptureUpperBound') return sample.latencyMs[metric]
  if (sample.pixels.text.chromatic < 20) return sample.latencyMs.highlightedPaintUpperBound
  if (sample.latencyMs.highlightCallback > sample.latencyMs.visibleTextUpperBound)
    return sample.latencyMs.highlightedPaintUpperBound
  return sample.latencyMs.visibleTextUpperBound
}
const metricValues = (result, key, metric) =>
  result.samples.filter((s) => identity(s) === key).map((s) => metricValue(s, metric))
const metrics = (sample) => [
  ...Object.keys(sample.latencyMs),
  ...(sample.plugin === 'tree-sitter' ? ['firstHighlightedCaptureUpperBound'] : []),
]
const groups = keys.map((key) => ({
  key,
  metrics: Object.fromEntries(
    metrics(before.samples.find((s) => identity(s) === key)).map((metric) => {
      const values = [before, control, after].map((result) =>
        summarize(metricValues(result, key, metric)),
      )
      return [
        metric,
        {
          before: values[0],
          control: values[1],
          after: values[2],
          medianChangeMs: values[2].median - values[0].median,
          medianChangePercent: values[0].median
            ? (values[2].median / values[0].median - 1) * 100
            : null,
        },
      ]
    }),
  ),
}))
const diagnostic = (result) =>
  result.samples.map((sample) => ({
    key: identity(sample),
    phases: sample.observation.diagnostics
      .filter(
        (event) =>
          event.name.startsWith('startup.') ||
          event.name === 'editor.fallbackFoldRanges' ||
          event.name === 'editor.secondary.folds',
      )
      .map((event) => ({
        name: event.name,
        durationMs: event.durationMs,
        startRelativeToOpenMs:
          event.at -
          (event.name.startsWith('startup.') ? 0 : (event.durationMs ?? 0)) -
          sample.timing.start,
        endRelativeToOpenMs:
          event.at +
          (event.name.startsWith('startup.') ? (event.durationMs ?? 0) : 0) -
          sample.timing.start,
      })),
    attachCompletedRelativeToOpenMs: sample.timing.attachedAt - sample.timing.start,
    textScreenshotCompletedRelativeToOpenMs: sample.latencyMs.visibleTextUpperBound,
  }))
const ordinaryHoldout = ['cold', 'warm'].map((state) => ({
  state,
  metrics: Object.fromEntries(
    metrics(ordinaryBefore.samples[0]).map((metric) => [
      metric,
      {
        before: summarize(metricValues(ordinaryBefore, `ordinary/direct/none/${state}`, metric)),
        after: summarize(metricValues(ordinaryAfter, `ordinary/direct/none/${state}`, metric)),
      },
    ]),
  ),
}))
const disposal = runs.flatMap((run) =>
  run.samples
    .filter((sample) => sample.beforeDisposalFence.retainedObjects)
    .map((sample) => ({
      runId: run.id,
      key: identity(sample),
      repetition: sample.repetition,
      before: sample.beforeDisposalFence,
      after: sample.cleanup,
    })),
)
const report = {
  schemaVersion: 1,
  passed: true,
  samplesValidated: runs.reduce((sum, r) => sum + r.samples.length, 0),
  runIds: {
    before: before.id,
    control: control.id,
    after: after.id,
    diagnosticBefore: diagnosticBefore.id,
    diagnosticAfter: diagnosticAfter.id,
    ordinaryBefore: ordinaryBefore.id,
    ordinaryAfter: ordinaryAfter.id,
    cleanupProbe: cleanupProbe.id,
  },
  measurement: 'screenshot-completion-upper-bound',
  ciThresholdInstalled: false,
  rejectionChecks: ['missing sample', 'duplicate sample', 'invalid group', 'fixture hash mismatch'],
  groups,
  ordinaryHoldout,
  disposal,
  diagnostics: { before: diagnostic(diagnosticBefore), after: diagnostic(diagnosticAfter) },
}
await writeFile(resolve(root, 'comparison.json'), JSON.stringify(report, null, 2) + '\n')
for (const group of groups) {
  const t = group.metrics.visibleTextUpperBound
  const a = group.metrics.attach
  console.log(
    `${group.key}\tattach ${a.before.median.toFixed(1)}/${a.control.median.toFixed(1)}/${a.after.median.toFixed(1)}\ttext ${t.before.median.toFixed(1)}/${t.control.median.toFixed(1)}/${t.after.median.toFixed(1)}`,
  )
}
