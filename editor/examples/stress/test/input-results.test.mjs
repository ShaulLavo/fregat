import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { correlateInputEvents } from '../input-correlation.mjs'
import {
  calibrateInput,
  compareInput,
  inputScenarios,
  inputViewModes,
  summarizeInputResult,
  validateInputResult,
} from '../input-results.mjs'

function result(id = 'control-1', duration = 10) {
  const fixtures = ['ordinary', 'short-lines', 'long-line'].map((fixture, index) => ({
    id: fixture,
    sha256: String(index + 1).repeat(64),
    bytes: 10,
    utf16Length: 10,
    normalizedLength: 10,
    lines: 1,
    longestLine: 10,
    searchCount: 0,
  }))
  return {
    schemaVersion: 1,
    suite: 'input-latency',
    id,
    environment: {
      commit: 'a'.repeat(40),
      sourceHash: 'b'.repeat(64),
      dirty: false,
      browser: { engine: 'chromium', version: '1', headless: true },
      hardware: {
        cpu: 'reference',
        logicalCpus: 4,
        memoryBytes: 1000,
        architecture: 'x64',
        platform: 'linux',
        release: '1',
      },
      runtime: 'v24.0.0',
    },
    manifest: { schemaVersion: 1, generatorVersion: 1, seed: 60061, fixtures },
    config: {
      repetitions: 2,
      warmups: 1,
      scenarios: inputScenarios,
      views: inputViewModes,
      compositionCommitTrust: 'cdp-untrusted-compositionend',
      isolation: 'closed-browser-context-per-fixture-view-scenario',
      diagnostics: false,
      slowdownMs: 0,
      operationsPerSample: Object.fromEntries(inputScenarios.map((scenario) => [scenario, 2])),
    },
    samples: fixtures.flatMap((fixture) => fixtureSamples(fixture, duration)),
  }
}

function fixtureSamples(fixture, duration) {
  return inputViewModes.flatMap((views) =>
    inputScenarios.flatMap((scenario) => scenarioSamples(fixture, views, scenario, duration)),
  )
}

function scenarioSamples(fixture, views, scenario, duration) {
  return [0, 1].map((repetition) => ({
    fixture: fixture.id,
    fixtureHash: fixture.sha256,
    views,
    scenario,
    repetition,
    state: 'warm',
    correct: true,
    cleanup: {
      active: false,
      hosts: 0,
      pendingFrames: 0,
      retainedObjects: 0,
      trackedObjects: views === 'multiple' ? 4 : 2,
      contextClosed: true,
      beforeListeners: 10,
      afterListeners: 5,
    },
    ...observations(scenario, duration, views),
  }))
}

function observations(scenario, duration, views) {
  const events = [0, 1].map((index) => event(scenario, index, duration))
  const paint = {
    method: 'screenshot-completion-upper-bound',
    startedAt: events.at(-1).frameAt,
    completedAt: events.at(-1).frameAt + 2,
    imageChanged: true,
    operation: null,
    revision: events.at(-1).revisionAfter,
  }
  const rendered = Array.from({ length: views === 'multiple' ? 3 : 1 }, (_, view) => ({
    view,
    hidden: false,
    rows: 1,
    chunks: 1,
    verifiedText: true,
  }))
  return {
    observation: {
      events,
      paint,
      rendered,
      revision: events.at(-1).revisionAfter,
      diagnostics: [],
      droppedDiagnostics: 0,
      correlations: null,
    },
    latencyMs: {
      inputToApplied: events.map((entry) => entry.appliedAt - entry.at),
      dispatch: events.map((entry) => entry.completedAt - entry.dispatchAt),
      inputToFrame: events.map((entry) => entry.frameAt - entry.at),
      burstToPaintUpperBound: [paint.completedAt - events[0].at],
    },
  }
}

function event(scenario, index, duration) {
  const at = 1000 + index * 1000
  const preedit = scenario === 'composition-update'
  return {
    id: index + 1,
    ...eventSemantics(scenario),
    at,
    dispatchAt: at + 0.25,
    appliedAt: at + Math.max(duration + (preedit ? 0.25 : 0), 0.25),
    completedAt: at + duration + 0.25,
    frameAt: at + duration + 1,
    revisionBefore: preedit ? 0 : index,
    revisionAfter: preedit ? 0 : index + 1,
    trusted: scenario !== 'composition-commit',
    repeat: scenario === 'repeat',
  }
}

function eventSemantics(scenario) {
  if (scenario === 'typing' || scenario === 'repeat')
    return { eventType: 'beforeinput', inputType: 'insertText' }
  if (scenario === 'composition-update')
    return { eventType: 'compositionupdate', inputType: 'compositionupdate' }
  if (scenario === 'composition-commit')
    return { eventType: 'compositionend', inputType: 'compositionend' }
  if (scenario === 'paste') return { eventType: 'paste', inputType: 'paste' }
  return { eventType: 'keydown', inputType: 'keydown' }
}

function resultWithTimingRange(id) {
  const run = result(id, 3)
  for (const sample of run.samples) {
    if (sample.repetition !== 0) continue
    const first = event(sample.scenario, 0, 1)
    sample.observation.events[0] = first
    sample.latencyMs.inputToApplied[0] = first.appliedAt - first.at
    sample.latencyMs.dispatch[0] = first.completedAt - first.dispatchAt
    sample.latencyMs.inputToFrame[0] = first.frameAt - first.at
  }
  return run
}

function controls() {
  return [result(), result('control-2', 11), result('control-3', 9)]
}

function delayScreenshots(run, delayMs) {
  for (const sample of run.samples) {
    sample.observation.paint.completedAt += delayMs
    sample.latencyMs.burstToPaintUpperBound[0] += delayMs
  }
  return run
}

function delayFrames(run, delayMs) {
  for (const sample of run.samples) {
    for (const event of sample.observation.events) event.frameAt += delayMs
    sample.latencyMs.inputToFrame = sample.latencyMs.inputToFrame.map((value) => value + delayMs)
    sample.observation.paint.startedAt += delayMs
  }
  return delayScreenshots(run, delayMs)
}

function enableDiagnostics(run) {
  run.config.diagnostics = true
  for (const sample of run.samples) attachDiagnostics(sample)
  return run
}

function attachDiagnostics(sample) {
  const { observation } = sample
  observation.diagnostics = observation.events.flatMap((event) => eventDiagnostics(sample, event))
  observation.correlations = correlateInputEvents({
    events: observation.events,
    diagnostics: observation.diagnostics,
    scenario: sample.scenario,
    views: sample.views,
    documentId: sample.fixture,
  })
  observation.paint.operation = observation.correlations.at(-1).operation
}

function eventDiagnostics(sample, event) {
  const input = sample.scenario === 'undo' ? 'undo' : `input.${event.eventType}`
  const operation = { id: event.id, input, startedAtMs: event.dispatchAt }
  const end = {
    name: 'editor.input',
    timestampMs: event.completedAt,
    durationMs: event.completedAt - event.dispatchAt,
    operation,
  }
  if (sample.scenario === 'composition-update') return [end]
  const views = Array.from({ length: sample.views === 'multiple' ? 3 : 1 }, (_, index) => ({
    id: `editor-${index}`,
    documentId: sample.fixture,
    revision: event.revisionAfter,
    documentVersion: event.revisionAfter,
  }))
  return [
    ...views.flatMap((view) => [
      { name: 'editor.document.committed', timestampMs: event.dispatchAt, operation, view },
      { name: 'editor.view.updated', timestampMs: event.appliedAt, operation, view },
    ]),
    end,
  ]
}

describe('input latency result contract', () => {
  it('recomputes diagnostic correlations and binds paint to the final operation and revision', () => {
    const run = enableDiagnostics(result())
    expect(validateInputResult(run)).toBe(run)
    expect(run.samples[0].observation.paint.operation.id).toBe(2)
    expect(run.samples[0].observation.paint.revision).toBe(2)
  })

  it.each([
    [
      'missing timeline',
      (sample) => {
        delete sample.observation.diagnostics
      },
      /Missing diagnostic timeline/,
    ],
    [
      'missing operation',
      (sample) => {
        sample.observation.diagnostics = sample.observation.diagnostics.filter(
          (record) => record.name !== 'editor.input',
        )
      },
      /Missing or ambiguous operation/,
    ],
    [
      'forged event scope',
      (sample) => {
        sample.observation.events[0].dispatchAt += 1
        sample.latencyMs.dispatch[0] -= 1
      },
      /Missing or ambiguous operation/,
    ],
    [
      'missing peer update',
      (sample) => {
        sample.observation.diagnostics.splice(1, 1)
      },
      /affected view diagnostics/,
    ],
    [
      'forged correlation',
      (sample) => {
        sample.observation.correlations[0].eventId = 99
      },
      /input diagnostic correlations/,
    ],
    [
      'missing correlations',
      (sample) => {
        delete sample.observation.correlations
      },
      /input diagnostic correlations/,
    ],
    [
      'wrong final operation',
      (sample) => {
        sample.observation.paint.operation = sample.observation.correlations[0].operation
      },
      /paint operation/,
    ],
    [
      'wrong paint revision',
      (sample) => {
        sample.observation.paint.revision = 1
      },
      /paint revision/,
    ],
    [
      'wrong observed revision',
      (sample) => {
        sample.observation.revision = 1
      },
      /final observed revision/,
    ],
  ])('rejects diagnostic correlation claims: %s', (_label, mutate, message) => {
    const run = enableDiagnostics(result())
    mutate(run.samples.find((sample) => sample.views === 'multiple'))
    expect(() => validateInputResult(run)).toThrow(message)
  })

  it('requires null correlation and paint identities while diagnostics are disabled', () => {
    const missing = result()
    delete missing.samples[0].observation.correlations
    expect(() => validateInputResult(missing)).toThrow(/disabled diagnostic correlations/)
    const claimed = result()
    claimed.samples[0].observation.paint.operation = { id: 1 }
    expect(() => validateInputResult(claimed)).toThrow(/disabled paint operation/)
  })
  it('preserves weak observations when disposal closes the context without listener growth', () => {
    const run = result()
    run.samples[0].cleanup.retainedObjects = 2
    expect(validateInputResult(run).samples[0].cleanup.retainedObjects).toBe(2)
  })

  it.each([
    [
      'missing isolation mode',
      (run) => {
        delete run.config.isolation
      },
      /sample isolation/,
    ],
    [
      'open context',
      (run) => {
        run.samples[0].cleanup.contextClosed = false
      },
      /cleanup/,
    ],
    [
      'missing context closure',
      (run) => {
        delete run.samples[0].cleanup.contextClosed
      },
      /cleanup/,
    ],
    [
      'missing tracked count',
      (run) => {
        delete run.samples[0].cleanup.trackedObjects
      },
      /cleanup/,
    ],
    [
      'wrong tracked count',
      (run) => {
        run.samples[0].cleanup.trackedObjects = 3
      },
      /cleanup/,
    ],
    [
      'missing retained count',
      (run) => {
        delete run.samples[0].cleanup.retainedObjects
      },
      /cleanup retained/,
    ],
    [
      'missing initial listeners',
      (run) => {
        delete run.samples[0].cleanup.beforeListeners
      },
      /cleanup listener/,
    ],
    [
      'missing final listeners',
      (run) => {
        delete run.samples[0].cleanup.afterListeners
      },
      /cleanup listener/,
    ],
    [
      'listener growth',
      (run) => {
        run.samples[0].cleanup.afterListeners = 11
      },
      /cleanup counts/,
    ],
    [
      'fractional listeners',
      (run) => {
        run.samples[0].cleanup.afterListeners = 1.5
      },
      /cleanup listener/,
    ],
  ])('rejects incomplete context cleanup: %s', (_label, mutate, message) => {
    const run = result()
    mutate(run)
    expect(() => validateInputResult(run)).toThrow(message)
  })
  it('identifies emulated CDP composition commits while requiring trusted other input', () => {
    expect(validateInputResult(result()).config.compositionCommitTrust).toBe(
      'cdp-untrusted-compositionend',
    )
    const mislabeled = result()
    mislabeled.samples.find(
      (sample) => sample.scenario === 'composition-commit',
    ).observation.events[0].trusted = true
    expect(() => validateInputResult(mislabeled)).toThrow(/mislabeled CDP/)
    const noLabel = result()
    delete noLabel.config.compositionCommitTrust
    expect(() => validateInputResult(noLabel)).toThrow(/composition commit trust/)
    const untrusted = result()
    untrusted.samples[0].observation.events[0].trusted = false
    expect(() => validateInputResult(untrusted)).toThrow(/Untrusted/)
  })

  it.each([
    [
      'missing views',
      (run) => {
        delete run.samples[0].observation.rendered
      },
      /rendered view observations/,
    ],
    [
      'missing peer',
      (run) => {
        run.samples.find((sample) => sample.views === 'multiple').observation.rendered.pop()
      },
      /rendered view observations/,
    ],
    [
      'duplicate view',
      (run) => {
        run.samples.find((sample) => sample.views === 'multiple').observation.rendered[1].view = 0
      },
      /view correctness/,
    ],
    [
      'still hidden',
      (run) => {
        run.samples[0].observation.rendered[0].hidden = true
      },
      /view correctness/,
    ],
    [
      'unchecked text',
      (run) => {
        run.samples[0].observation.rendered[0].verifiedText = false
      },
      /view correctness/,
    ],
    [
      'empty rows',
      (run) => {
        run.samples[0].observation.rendered[0].rows = 0
      },
      /rendered row count/,
    ],
    [
      'empty chunks',
      (run) => {
        run.samples[0].observation.rendered[0].chunks = 0
      },
      /rendered chunk count/,
    ],
    [
      'missing pixel check',
      (run) => {
        delete run.samples[0].observation.paint.imageChanged
      },
      /missing or unchanged pixels/,
    ],
  ])('rejects incomplete rendered observations: %s', (_label, mutate, message) => {
    const run = result()
    mutate(run)
    expect(() => validateInputResult(run)).toThrow(message)
  })
  it('rejects smoke-only runs and premature preedit completion', () => {
    expect(() => validateInputResult({ ...result(), smokeOnly: true })).toThrow(/Smoke-only/)
    const preedit = result()
    preedit.samples.find(
      (sample) => sample.scenario === 'composition-update',
    ).observation.events[0].appliedAt -= 0.1
    expect(() => validateInputResult(preedit)).toThrow(/preedit completion/)
  })
  it('rejects mislabeled native scenarios and unsupported paint or diagnostic claims', () => {
    const mislabeled = result()
    mislabeled.samples[0].observation.events[0].eventType = 'input'
    expect(() => validateInputResult(mislabeled)).toThrow(/event semantics/)
    const repeated = result()
    repeated.samples.find((sample) => sample.scenario === 'repeat').observation.events[1].repeat =
      false
    expect(() => validateInputResult(repeated)).toThrow(/native key repeat/)
    const unchanged = result()
    unchanged.samples[0].observation.paint.imageChanged = false
    expect(() => validateInputResult(unchanged)).toThrow(/unchanged pixels/)
    const dropped = result()
    dropped.samples[0].observation.droppedDiagnostics = 1
    expect(() => validateInputResult(dropped)).toThrow(/Dropped diagnostic/)
    const disabled = result()
    disabled.samples[0].observation.diagnostics = [{}]
    expect(() => validateInputResult(disabled)).toThrow(/Disabled diagnostics/)
  })
  it('retains p50, p95, p99, max and the original event samples', () => {
    const run = result()
    expect(validateInputResult(run)).toBe(run)
    expect(summarizeInputResult(run)['ordinary/single/typing/inputToApplied']).toEqual({
      count: 4,
      p50Ms: 10,
      p95Ms: 10,
      p99Ms: 10,
      maxMs: 10,
      rawSamples: [10, 10, 10, 10],
    })
  })

  it.each([
    [
      'missing repetitions',
      (run) => {
        run.samples.pop()
      },
      /Missing samples/,
    ],
    [
      'duplicate samples',
      (run) => {
        run.samples.push(run.samples[0])
      },
      /Duplicate sample/,
    ],
    [
      'missing fixtures',
      (run) => {
        run.manifest.fixtures.pop()
      },
      /fixture/,
    ],
    [
      'cold state',
      (run) => {
        run.samples[0].state = 'cold'
      },
      /configuration/,
    ],
    [
      'missing views',
      (run) => {
        run.config.views = ['single']
      },
      /view coverage/,
    ],
    [
      'missing scenarios',
      (run) => {
        run.config.scenarios = ['typing']
      },
      /scenario coverage/,
    ],
    [
      'missing operations',
      (run) => {
        run.samples[0].observation.events.pop()
      },
      /per-operation/,
    ],
    [
      'missing timings',
      (run) => {
        run.samples[0].latencyMs.dispatch.pop()
      },
      /Missing dispatch/,
    ],
    [
      'missing metric',
      (run) => {
        delete run.samples[0].latencyMs.inputToFrame
      },
      /latency coverage/,
    ],
    [
      'unknown metric',
      (run) => {
        run.samples[0].latencyMs.paint = [1]
      },
      /latency coverage/,
    ],
    [
      'missing hash',
      (run) => {
        delete run.samples[0].fixtureHash
      },
      /hash mismatch/,
    ],
    [
      'missing runtime',
      (run) => {
        delete run.environment.runtime
      },
      /runtime/,
    ],
    [
      'missing source',
      (run) => {
        delete run.environment.sourceHash
      },
      /source hash/,
    ],
    [
      'negative count',
      (run) => {
        run.config.operationsPerSample.typing = -1
      },
      /operation count/,
    ],
    [
      'nonfinite count',
      (run) => {
        run.config.repetitions = Infinity
      },
      /repetitions/,
    ],
    [
      'nonfinite latency',
      (run) => {
        run.samples[0].latencyMs.dispatch[0] = NaN
      },
      /raw latency/,
    ],
    [
      'negative latency',
      (run) => {
        run.samples[0].latencyMs.dispatch[0] = -1
      },
      /raw latency/,
    ],
    [
      'null latency',
      (run) => {
        run.samples[0].latencyMs.dispatch[0] = null
      },
      /raw latency/,
    ],
    [
      'failed correctness',
      (run) => {
        run.samples[0].correct = false
      },
      /correctness/,
    ],
    [
      'active editor',
      (run) => {
        run.samples[0].cleanup.active = true
      },
      /cleanup/,
    ],
    [
      'absent active status',
      (run) => {
        delete run.samples[0].cleanup.active
      },
      /cleanup/,
    ],
    [
      'retained hosts',
      (run) => {
        run.samples[0].cleanup.hosts = 1
      },
      /cleanup/,
    ],
    [
      'pending frames',
      (run) => {
        run.samples[0].cleanup.pendingFrames = 1
      },
      /cleanup/,
    ],
    [
      'retained objects exceed tracked count',
      (run) => {
        run.samples[0].cleanup.retainedObjects = 3
      },
      /cleanup/,
    ],
    [
      'untrusted input',
      (run) => {
        run.samples[0].observation.events[0].trusted = false
      },
      /Untrusted/,
    ],
    [
      'absent trust',
      (run) => {
        delete run.samples[0].observation.events[0].trusted
      },
      /Untrusted/,
    ],
    [
      'duplicate identity',
      (run) => {
        run.samples[0].observation.events[1].id = 1
      },
      /Duplicate operation/,
    ],
    [
      'unchanged edit revision',
      (run) => {
        run.samples[0].observation.events[0].revisionAfter = 0
      },
      /new document revision/,
    ],
    [
      'disconnected revisions',
      (run) => {
        run.samples[0].observation.events[1].revisionBefore = 0
      },
      /Disconnected/,
    ],
    [
      'revision-changing preedit',
      (run) => {
        run.samples.find(
          (sample) => sample.scenario === 'composition-update',
        ).observation.events[0].revisionAfter = 1
      },
      /preedit/,
    ],
    [
      'forged timings',
      (run) => {
        run.samples[0].latencyMs.inputToApplied[0] = 1
      },
      /disagrees/,
    ],
    [
      'backwards phases',
      (run) => {
        run.samples[0].observation.events[0].appliedAt = 1
      },
      /phase ordering/,
    ],
    [
      'frame called paint',
      (run) => {
        run.samples[0].observation.paint.method = 'requestAnimationFrame'
      },
      /screenshot paint/,
    ],
    [
      'paint before edit',
      (run) => {
        run.samples[0].observation.paint.startedAt = 1
      },
      /screenshot phase/,
    ],
    [
      'forged paint latency',
      (run) => {
        run.samples[0].latencyMs.burstToPaintUpperBound[0] = 1
      },
      /disagrees/,
    ],
  ])('rejects %s before interpreting timings', (_label, mutate, error) => {
    const run = result()
    mutate(run)
    expect(() => validateInputResult(run)).toThrow(error)
  })
})

describe('input latency calibration', () => {
  it('uses the full observed control range when the median and p95 hide faster observations', () => {
    const runs = [1, 2, 3].map((id) => resultWithTimingRange(`control-${id}`))
    const calibration = calibrateInput(runs)
    const comparison = compareInput(runs[0], result('holdout', 4), calibration)
    expect(comparison.passed).toBe(true)
    expect(calibration.limits['ordinary/single/typing/dispatch']).toEqual({
      p95Ms: 5,
      noiseMarginMs: 2,
      controlP50Ms: [3, 3, 3],
      controlP95Ms: [3, 3, 3],
      controlMinMs: [1, 1, 1],
      controlMaxMs: [3, 3, 3],
    })
    expect(
      comparison.metrics.find((metric) => metric.key === 'ordinary/single/typing/dispatch').baseline
        .rawSamples,
    ).toEqual([1, 3, 3, 3])
    expect(compareInput(runs[0], result('boundary', 5), calibration).passed).toBe(true)
    expect(compareInput(runs[0], result('regression', 5.1), calibration).passed).toBe(false)
  })

  it('rejects every 20 ms delayed dispatch group after calibrating observed ranges', () => {
    const runs = [1, 2, 3].map((id) => resultWithTimingRange(`control-${id}`))
    const delayed = result('delayed', 23)
    delayed.config.slowdownMs = 20
    const comparison = compareInput(runs[0], delayed, calibrateInput(runs), { allowSlowdown: true })
    const dispatch = comparison.metrics.filter((metric) => metric.key.endsWith('/dispatch'))
    expect(comparison.passed).toBe(false)
    expect(dispatch).toHaveLength(36)
    expect(dispatch.every((metric) => metric.blocking && !metric.passed)).toBe(true)
  })

  it.each(['controlMinMs', 'controlMaxMs'])('rejects tampered %s evidence', (field) => {
    const runs = [1, 2, 3].map((id) => resultWithTimingRange(`control-${id}`))
    const calibration = calibrateInput(runs)
    calibration.limits['ordinary/single/typing/dispatch'][field][0] += 0.25
    expect(() => compareInput(runs[0], result('candidate'), calibration)).toThrow(
      /calibration derived from raw controls/,
    )
  })

  it('reports screenshot-only timing excesses as advisory without changing their limits or samples', () => {
    const runs = controls()
    const calibration = calibrateInput(runs)
    const originalCalibration = JSON.stringify(calibration)
    const candidate = delayScreenshots(result('candidate'), 50)
    const comparison = compareInput(runs[0], candidate, calibration)
    const advisory = comparison.metrics.filter((metric) => !metric.blocking)
    const blocking = comparison.metrics.filter((metric) => metric.blocking)
    expect(comparison.passed).toBe(true)
    expect(advisory).toHaveLength(36)
    expect(
      advisory.every((metric) => metric.key.endsWith('/burstToPaintUpperBound') && !metric.passed),
    ).toBe(true)
    expect(blocking).toHaveLength(108)
    expect(blocking.every((metric) => metric.passed)).toBe(true)
    expect(advisory[0].rawSamples).toEqual([1063, 1063])
    expect(JSON.stringify(calibration)).toBe(originalCalibration)
  })

  it('rejects incorrect screenshots even when screenshot timing is advisory', () => {
    const runs = controls()
    const candidate = delayScreenshots(result('candidate'), 50)
    candidate.samples[0].observation.paint.imageChanged = false
    expect(() => compareInput(runs[0], candidate, calibrateInput(runs))).toThrow(
      /missing or unchanged pixels/,
    )
  })

  it('keeps slow frame observations blocking even when screenshot timing is advisory', () => {
    const runs = controls()
    const candidate = delayFrames(result('candidate'), 50)
    const comparison = compareInput(runs[0], candidate, calibrateInput(runs))
    const failures = comparison.metrics.filter((metric) => metric.blocking && !metric.passed)
    expect(comparison.passed).toBe(false)
    expect(failures).toHaveLength(36)
    expect(failures.every((metric) => metric.key.endsWith('/inputToFrame'))).toBe(true)
  })

  it('keeps the 20 ms delayed dispatch control blocking', () => {
    const runs = controls()
    const delayed = result('delayed', 30)
    delayed.config.slowdownMs = 20
    const comparison = compareInput(runs[0], delayed, calibrateInput(runs), { allowSlowdown: true })
    const dispatch = comparison.metrics.filter((metric) => metric.key.endsWith('/dispatch'))
    expect(comparison.passed).toBe(false)
    expect(dispatch).toHaveLength(36)
    expect(dispatch.every((metric) => metric.blocking && !metric.passed)).toBe(true)
  })

  it.each([
    [0.2000000011175871, 0.20000000298023224],
    [1.900000000372529, 1.9000000022351742],
  ])(
    'accepts timestamp rounding at the %s ms limit without changing it',
    (limitMs, candidateMs) => {
      const runs = [1, 2, 3].map((id) => result(`control-${id}`, limitMs))
      const calibration = calibrateInput(runs)
      const originalCalibration = JSON.stringify(calibration)
      const comparison = compareInput(runs[0], result('candidate', candidateMs), calibration)
      const dispatch = comparison.metrics.find(
        (metric) => metric.key === 'ordinary/single/typing/dispatch',
      )
      expect(dispatch.limit.p95Ms).toBe(limitMs)
      expect(dispatch.p95Ms).toBe(candidateMs)
      expect(dispatch.rawSamples).toEqual([candidateMs, candidateMs, candidateMs, candidateMs])
      expect(comparison.passed).toBe(true)
      expect(comparison.comparisonEpsilonMs).toBe(0.000001)
      expect(JSON.stringify(calibration)).toBe(originalCalibration)
    },
  )

  it.each([0.000002, 0.1])('rejects a %s ms excess beyond timestamp tolerance', (excessMs) => {
    const limitMs = 0.2000000011175871
    const runs = [1, 2, 3].map((id) => result(`control-${id}`, limitMs))
    const comparison = compareInput(
      runs[0],
      result('candidate', limitMs + excessMs),
      calibrateInput(runs),
    )
    expect(comparison.passed).toBe(false)
    expect(
      comparison.metrics
        .filter((metric) => metric.key.endsWith('/dispatch'))
        .every((metric) => !metric.passed),
    ).toBe(true)
  })

  it('derives a local p95 noise envelope and detects a real-delay workload variant', () => {
    const runs = controls()
    const calibration = calibrateInput(runs)
    expect(calibration.limits['ordinary/single/typing/dispatch']).toEqual({
      p95Ms: 17,
      noiseMarginMs: 6,
      controlP50Ms: [10, 11, 9],
      controlP95Ms: [10, 11, 9],
      controlMinMs: [10, 11, 9],
      controlMaxMs: [10, 11, 9],
    })
    expect(calibration.controlRuns).toBe(runs)
    expect(compareInput(runs[0], result('rerun'), calibration).passed).toBe(true)
    const delayed = result('delayed', 100)
    delayed.config.slowdownMs = 90
    expect(() => compareInput(runs[0], delayed, calibration)).toThrow(/workload/)
    const regression = compareInput(runs[0], delayed, calibration, { allowSlowdown: true })
    expect(regression.passed).toBe(false)
    expect(regression.kind).toBe('delayed-control')
    expect(regression.metrics.every((metric) => !metric.passed)).toBe(true)
    expect(regression.metrics[0].limitToControlP95Ratio).toBeCloseTo(17 / 11)
  })

  it.each([
    [
      'browser',
      (run) => {
        run.environment.browser.version = '2'
      },
      /browser/,
    ],
    [
      'hardware',
      (run) => {
        run.environment.hardware.cpu = 'other'
      },
      /hardware/,
    ],
    [
      'runtime',
      (run) => {
        run.environment.runtime = 'v25.0.0'
      },
      /runtime/,
    ],
    [
      'manifest',
      (run) => {
        run.manifest.seed = 2
      },
      /fixture manifests/,
    ],
    [
      'diagnostics',
      (run) => {
        enableDiagnostics(run)
      },
      /workload/,
    ],
    [
      'warmup count',
      (run) => {
        run.config.warmups = 2
      },
      /workload/,
    ],
    [
      'new workload option',
      (run) => {
        run.config.pasteText = 'different'
      },
      /workload/,
    ],
  ])('rejects incomparable %s even for delay controls', (_label, mutate, error) => {
    const runs = controls()
    const candidate = result('candidate')
    candidate.config.slowdownMs = 1
    mutate(candidate)
    expect(() =>
      compareInput(runs[0], candidate, calibrateInput(runs), { allowSlowdown: true }),
    ).toThrow(error)
  })

  it('allows a changed candidate source while controls must share the same source', () => {
    const runs = controls()
    const candidate = result('candidate')
    candidate.environment.commit = 'c'.repeat(40)
    candidate.environment.sourceHash = 'd'.repeat(64)
    expect(compareInput(runs[0], candidate, calibrateInput(runs)).passed).toBe(true)
    runs[1].environment.sourceHash = candidate.environment.sourceHash
    expect(() => calibrateInput(runs)).toThrow(/control source trees/)
  })

  it('rejects reused, insufficient, changed-commit and delayed controls', () => {
    expect(() => calibrateInput([result()])).toThrow(/three independent/)
    expect(() => calibrateInput([result(), result(), result()])).toThrow(/distinct/)
    const changed = controls()
    changed[1].environment.commit = 'different'
    expect(() => calibrateInput(changed)).toThrow(/control commits/)
    const delayed = controls()
    for (const run of delayed) run.config.slowdownMs = 1
    expect(() => calibrateInput(delayed)).toThrow(/clean controls/)
  })

  it('recomputes calibration from raw controls and rejects altered limits and baseline data', () => {
    const runs = controls()
    const calibration = calibrateInput(runs)
    calibration.limits['ordinary/single/typing/dispatch'].p95Ms = 1000
    expect(() => compareInput(runs[0], result('candidate'), calibration)).toThrow(
      /derived from raw controls/,
    )
    const missing = calibrateInput(runs)
    delete missing.limits['ordinary/single/typing/dispatch']
    expect(() => compareInput(runs[0], result('candidate'), missing)).toThrow(
      /derived from raw controls/,
    )
    expect(() =>
      compareInput(result('unknown'), result('candidate'), calibrateInput(runs)),
    ).toThrow(/identify this baseline/)
    expect(() =>
      compareInput(result('control-1', 12), result('candidate'), calibrateInput(runs)),
    ).toThrow(/baseline observations/)
  })

  it('requires a held-out run and an actual configured delay for the positive control', () => {
    const runs = controls()
    const calibration = calibrateInput(runs)
    expect(() => compareInput(runs[0], runs[1], calibration)).toThrow(/independent run/)
    expect(() =>
      compareInput(runs[0], result('candidate'), calibration, { allowSlowdown: true }),
    ).toThrow(/injected delay/)
  })
})

it('CLI writes a reproducible calibration and returns nonzero for the delayed candidate', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'editor-input-gate-test-'))
  try {
    await checkCli(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

async function checkCli(directory) {
  const runs = controls()
  const delayed = result('delayed', 100)
  delayed.config.slowdownMs = 90
  const all = [...runs, result('rerun'), delayed]
  await Promise.all(
    all.map((run) => writeFile(join(directory, `${run.id}.json`), JSON.stringify(run))),
  )
  const script = fileURLToPath(new URL('../input-compare.mjs', import.meta.url))
  const invoke = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: directory,
      encoding: 'utf8',
      maxBuffer: 4_000_000,
    })
  const calibrationPath = join(directory, 'calibration.json')
  expect(invoke('calibrate', calibrationPath, ...runs.map((run) => `${run.id}.json`)).status).toBe(
    0,
  )
  expect(JSON.parse(await readFile(calibrationPath, 'utf8'))).toEqual(calibrateInput(runs))
  const rerun = invoke('check', 'control-1.json', 'rerun.json', calibrationPath)
  expect(rerun.status).toBe(0)
  expect(JSON.parse(rerun.stdout).passed).toBe(true)
  const regression = invoke(
    'check',
    'control-1.json',
    'delayed.json',
    calibrationPath,
    '--allow-slowdown',
  )
  expect(regression.status).toBe(1)
  expect(JSON.parse(regression.stdout).passed).toBe(false)
  expect(invoke('check', 'control-1.json', 'delayed.json', calibrationPath).status).not.toBe(0)
  expect(invoke('calibrate', calibrationPath, 'control-1.json').status).not.toBe(0)
}
