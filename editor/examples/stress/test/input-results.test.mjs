import { describe, expect, it } from 'vitest'
import { correlateInputEvents } from '../input-correlation.mjs'
import {
  comparePairedInput,
  pairedInterval,
  sensitivityPassed,
  touchedConfigurations,
} from '../input-paired.mjs'
import {
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

function delayScreenshots(run, delayMs) {
  for (const sample of run.samples) {
    sample.observation.paint.completedAt += delayMs
    sample.latencyMs.burstToPaintUpperBound[0] += delayMs
  }
  return run
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

function pairedResults(duration = 10) {
  const baseline = result('baseline')
  const candidate = result('candidate', duration)
  for (const run of [baseline, candidate]) {
    Object.assign(run.environment, {
      instrumentHash: 'b'.repeat(64),
      instrumentExternal: 'c'.repeat(64),
      packageSet: {
        sourceHash: 'd'.repeat(64),
        buildHash: 'e'.repeat(64),
        externalHash: 'a'.repeat(64),
      },
    })
    run.config.repetitions = 3
    run.samples.push(
      ...run.samples
        .filter((sample) => sample.repetition === 0)
        .map((sample) => ({ ...structuredClone(sample), repetition: 2 })),
    )
  }
  const schedule = baseline.samples.map((sample) => ({
    group: `${sample.fixture}/${sample.views}/${sample.scenario}`,
    repetition: sample.repetition,
    order: ['baseline', 'candidate'],
  }))
  return { baseline, candidate, schedule }
}

describe('paired input latency', () => {
  it('passes identical products and reports all 108 blocking and 36 advisory groups', () => {
    const { baseline, candidate, schedule } = pairedResults()
    const check = comparePairedInput(baseline, candidate, schedule, 60061)
    expect(check.passed).toBe(true)
    expect(check.metrics.filter((metric) => metric.blocking)).toHaveLength(108)
    expect(check.metrics.filter((metric) => !metric.blocking)).toHaveLength(36)
    expect(
      check.metrics.every((metric) => metric.differenceMs === 0 && metric.interval.lowMs === 0),
    ).toBe(true)
  })

  it('detects injected delay and accepts changed product bytes', () => {
    const { baseline, candidate, schedule } = pairedResults(30)
    candidate.config.slowdownMs = 20
    candidate.environment.sourceHash = 'f'.repeat(64)
    const check = comparePairedInput(baseline, candidate, schedule, 60061)
    expect(check.passed).toBe(false)
    expect(sensitivityPassed(check)).toBe(true)
    expect(
      check.metrics.every((metric) => metric.differenceMs === 20 && metric.interval.lowMs === 20),
    ).toBe(true)
  })

  it('resamples repetitions, not correlated operations, and includes zero for mixed pairs', () => {
    expect(pairedInterval([-3, 4, 20], 17)).toEqual({
      confidence: 0.95,
      lowMs: -3,
      highMs: 20,
      draws: 10000,
    })
    expect(pairedInterval([20, 20, 20], 17).lowMs).toBe(20)
    expect(() => pairedInterval([20, 20], 17)).toThrow(/three/)
  })

  it('never lets advisory timing fail the run', () => {
    const { baseline, candidate, schedule } = pairedResults()
    delayScreenshots(candidate, 100)
    const check = comparePairedInput(baseline, candidate, schedule, 17)
    expect(check.passed).toBe(true)
    expect(
      check.metrics.filter((metric) => !metric.blocking).every((metric) => !metric.passed),
    ).toBe(true)
  })

  it('rejects a missing or duplicated pair and malformed evidence', () => {
    const { baseline, candidate, schedule } = pairedResults()
    expect(() => comparePairedInput(baseline, candidate, schedule.slice(1), 17)).toThrow(/schedule/)
    schedule[0] = schedule[1]
    expect(() => comparePairedInput(baseline, candidate, schedule, 17)).toThrow(/duplicate/)
    candidate.samples.pop()
    expect(() => comparePairedInput(baseline, candidate, schedule, 17)).toThrow(/Missing samples/)
  })

  it('cancels load shared by each pair without treating operations as independent pairs', () => {
    const { baseline, candidate, schedule } = pairedResults()
    for (const run of [baseline, candidate]) {
      run.samples = [10, 110, 510].flatMap((duration, repetition) =>
        result(run.id, duration)
          .samples.filter((sample) => sample.repetition === 0)
          .map((sample) => ({ ...sample, repetition })),
      )
    }
    const check = comparePairedInput(baseline, candidate, schedule, 17)
    expect(check.passed).toBe(true)
    expect(
      check.metrics.every((metric) => metric.differences.length === 3 && metric.differenceMs === 0),
    ).toBe(true)
  })

  it('requires the budget and confidence conditions together', () => {
    const { baseline, candidate, schedule } = pairedResults()
    candidate.samples = [11, 11, 9].flatMap((duration, repetition) =>
      result(candidate.id, duration)
        .samples.filter((sample) => sample.repetition === 0)
        .map((sample) => ({ ...sample, repetition })),
    )
    const check = comparePairedInput(baseline, candidate, schedule, 17)
    expect(check.passed).toBe(true)
    expect(check.metrics.find((metric) => metric.key.endsWith('/dispatch')).differenceMs).toBe(1)
    expect(check.metrics.find((metric) => metric.key.endsWith('/dispatch')).interval.lowMs).toBe(-1)
  })

  it('keeps a significant difference within its existing noise budget advisory to acceptance', () => {
    const { baseline, candidate, schedule } = pairedResults()
    for (const [run, delay] of [
      [baseline, 0],
      [candidate, 1],
    ]) {
      run.samples = [10, 11, 10].flatMap((duration, repetition) =>
        result(run.id, duration + delay)
          .samples.filter((sample) => sample.repetition === 0)
          .map((sample) => ({ ...sample, repetition })),
      )
    }
    const check = comparePairedInput(baseline, candidate, schedule, 17)
    expect(check.passed).toBe(true)
    const dispatch = check.metrics.find((metric) => metric.key.endsWith('/dispatch'))
    expect(dispatch.differenceMs).toBe(1)
    expect(dispatch.interval.lowMs).toBe(1)
    expect(dispatch.budgetMs).toBe(3)
  })

  it('rejects a pair order that does not run each side exactly once', () => {
    const { baseline, candidate, schedule } = pairedResults()
    schedule[0].order = ['baseline', 'baseline']
    expect(() => comparePairedInput(baseline, candidate, schedule, 17)).toThrow(/pair order/)
  })

  it.each(['instrumentHash', 'instrumentExternal', 'packageSet'])(
    'requires a complete %s receipt on both sides',
    (field) => {
      const { baseline, candidate, schedule } = pairedResults()
      delete baseline.environment[field]
      delete candidate.environment[field]
      expect(() => comparePairedInput(baseline, candidate, schedule, 17)).toThrow(/receipt/)
    },
  )

  it('rejects differing external bytes in valid frozen-product receipts', () => {
    const { baseline, candidate, schedule } = pairedResults()
    candidate.environment.packageSet.externalHash = 'f'.repeat(64)
    expect(() => comparePairedInput(baseline, candidate, schedule, 17)).toThrow(/external/)
  })

  it('requires identical instrument, fixture and external bytes', () => {
    const { baseline, candidate, schedule } = pairedResults()
    candidate.environment.instrumentHash = 'f'.repeat(64)
    expect(() => comparePairedInput(baseline, candidate, schedule, 17)).toThrow(/instrument source/)
  })

  it('derives the default composition from changed package identities', () => {
    const packages = ['core', 'tree-sitter', 'minimap'].map((name) => ({
      name: `@singapore-editor/${name}`,
      sourceHash: 'a',
      buildHash: 'a',
    }))
    const baseline = { manifest: { packages } }
    expect(touchedConfigurations(baseline, baseline)).toEqual(['platform'])
    const candidate = {
      manifest: { packages: packages.map((entry) => ({ ...entry, sourceHash: 'b' })) },
    }
    expect(touchedConfigurations(baseline, candidate)).toEqual([
      'platform',
      'native',
      'disabled',
      'tree-sitter',
      'shiki',
      'minimap',
      'tree-sitter-shiki',
      'tree-sitter-minimap',
      'shiki-minimap',
      'all',
    ])
  })
  it.each([
    [
      'textbuffer',
      [
        'platform',
        'native',
        'disabled',
        'tree-sitter',
        'shiki',
        'minimap',
        'tree-sitter-shiki',
        'tree-sitter-minimap',
        'shiki-minimap',
        'all',
      ],
    ],
    [
      'tree-sitter-languages',
      ['platform', 'native', 'tree-sitter', 'tree-sitter-shiki', 'tree-sitter-minimap', 'all'],
    ],
    ['minimap', ['platform', 'minimap', 'tree-sitter-minimap', 'shiki-minimap', 'all']],
    ['find', ['platform', 'native']],
  ])(
    'includes every consuming composition for changed %s bytes and removed packages',
    (name, expected) => {
      const entry = { name: `@singapore-editor/${name}`, sourceHash: 'a', buildHash: 'a' }
      const baseline = { manifest: { packages: [entry] } }
      const candidate = { manifest: { packages: [{ ...entry, buildHash: 'b' }] } }
      expect(touchedConfigurations(baseline, candidate)).toEqual(expected)
      expect(touchedConfigurations(baseline, { manifest: { packages: [] } })).toEqual(expected)
    },
  )
})
