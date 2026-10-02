import { describe, expect, it } from 'vitest'
import { canStopInputPairs } from '../input-pair-stopping.mjs'
import { inputBudget } from '../input-budgets.mjs'
import { verifyInputSensitivity } from '../input-sensitivity.mjs'
import { inputSourceIdentity } from '../input-identity.mjs'
import { correlateInputEvents } from '../input-correlation.mjs'
import {
  comparePairedInput,
  frameDetectionFloorKey,
  inputPairOrder,
  pairedInterval,
  sensitivityPassed,
  inputMatrixConfigurations,
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
      frameSlowdownMs: 0,
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
      trackedObjects: views === 'multiple' ? 5 : 3,
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
        run.samples[0].cleanup.trackedObjects = 4
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
        run.samples[0].cleanup.retainedObjects = 4
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

function pairedResults(duration = 10, seed = 17) {
  const baseline = result('baseline')
  const candidate = result('candidate', duration)
  for (const run of [baseline, candidate]) {
    Object.assign(run.environment, {
      instrumentHash: 'b'.repeat(64),
      measurementHash: 'b'.repeat(64),
      validationHash: 'c'.repeat(64),
      instrumentExternal: 'c'.repeat(64),
      packageSet: {
        sourceHash: 'd'.repeat(64),
        buildHash: 'e'.repeat(64),
        externalHash: 'a'.repeat(64),
      },
    })
    run.config.loadProfile = 'quiet'
    run.config.repetitions = 4
    run.samples.push(
      ...run.samples
        .filter((sample) => sample.repetition === 0)
        .flatMap((sample) =>
          [2, 3].map((repetition) => ({ ...structuredClone(sample), repetition })),
        ),
    )
  }
  const schedule = baseline.samples.map((sample) => ({
    group: `${sample.fixture}/${sample.views}/${sample.scenario}`,
    repetition: sample.repetition,
    order: inputPairOrder(
      seed,
      `${sample.fixture}/${sample.views}/${sample.scenario}`,
      sample.repetition,
    ),
  }))
  return { baseline, candidate, schedule }
}

function sensitivityCache() {
  const control = (input, frame) => {
    const { baseline, candidate, schedule } = pairedResults(30)
    candidate.config.slowdownMs = input
    candidate.config.frameSlowdownMs = frame
    return {
      configuration: 'native',
      baseline,
      candidate,
      schedule,
      comparison: comparePairedInput(baseline, candidate, schedule, 17, 200),
    }
  }
  return {
    schemaVersion: 4,
    instrumentHash: 'b'.repeat(64),
    measurementHash: 'b'.repeat(64),
    validationHash: 'c'.repeat(64),
    passed: true,
    controls: { input: control(20, 0), frame: control(0, 20) },
    frameDetectionFloor: { key: frameDetectionFloorKey, delayMs: 25, attempts: [control(0, 25)] },
  }
}

describe('paired input latency', () => {
  it('balances every complete block independently of other keys and adaptive counts', () => {
    const keys = ['ordinary/single/undo', 'ordinary/multiple/undo', 'short-lines/multiple/paste']
    const orders = (key, count, seed = 17) =>
      Array.from({ length: count }, (_, repetition) => inputPairOrder(seed, key, repetition))
    const expected = new Map(keys.map((key) => [key, orders(key, 4)]))
    for (const key of keys.toReversed()) {
      orders('earlier/adaptive/group', 2)
      expect(orders(key, 4)).toEqual(expected.get(key))
      orders('earlier/adaptive/group', 8)
      expect(orders(key, 2)).toEqual(expected.get(key).slice(0, 2))
      for (let block = 0; block < 4; block += 2)
        expect(expected.get(key)[block]).toEqual(expected.get(key)[block + 1].toReversed())
    }
    const firstSides = Array.from({ length: 32 }, (_, seed) => orders(keys[0], 2, seed)[0][0])
    expect(new Set(firstSides)).toEqual(new Set(['baseline', 'candidate']))
  })

  it('rejects unbalanced blocks and balanced schedules from a different key seed', () => {
    const { baseline, candidate, schedule } = pairedResults()
    const first = schedule[0]
    const second = schedule.find((pair) => pair.group === first.group && pair.repetition === 1)
    second.order = first.order
    expect(() => comparePairedInput(baseline, candidate, schedule, 17)).toThrow(/pair order/)
    for (const pair of schedule)
      pair.order = inputPairOrder(17, pair.group, pair.repetition).toReversed()
    expect(() => comparePairedInput(baseline, candidate, schedule, 17)).toThrow(/pair order/)
  })

  it('accepts larger even fixed samples without changing the statistic', () => {
    const { baseline, candidate, schedule } = pairedResults()
    for (const run of [baseline, candidate]) {
      run.config.repetitions = 6
      run.samples.push(
        ...run.samples
          .filter((sample) => sample.repetition === 0)
          .flatMap((sample) =>
            [4, 5].map((repetition) => ({ ...structuredClone(sample), repetition })),
          ),
      )
    }
    const pairs = baseline.samples.map((sample) => {
      const group = `${sample.fixture}/${sample.views}/${sample.scenario}`
      return {
        group,
        repetition: sample.repetition,
        order: inputPairOrder(17, group, sample.repetition),
      }
    })
    expect(pairs).toHaveLength(schedule.length + 72)
    const check = comparePairedInput(baseline, candidate, pairs, 17, 200)
    expect(check.passed).toBe(true)
    expect(check.metrics.every((metric) => metric.differences.length === 6)).toBe(true)
    expect(check.stoppingPolicy).toBe('fixed-repetitions')
  })

  it('rejects odd fixed samples and incomplete adaptive blocks', () => {
    const { baseline, candidate, schedule } = pairedResults()
    for (const run of [baseline, candidate]) {
      run.config.repetitions = 3
      run.samples = run.samples.filter((sample) => sample.repetition < 3)
    }
    const pairs = schedule.filter((pair) => pair.repetition < 3)
    expect(() => comparePairedInput(baseline, candidate, pairs, 17)).toThrow(/two-pair blocks/)
    for (const run of [baseline, candidate]) {
      run.config.repetitions = 4
      run.config.adaptivePairs = 'counterbalanced-tight-within-budget'
      run.config.groupRepetitions = Object.fromEntries(
        run.samples.map((sample) => [`${sample.fixture}/${sample.views}/${sample.scenario}`, 3]),
      )
    }
    expect(() => comparePairedInput(baseline, candidate, pairs, 17)).toThrow(
      /incomplete two-pair block/,
    )
  })

  it('preserves the strict span guard even when the two-pair accept predicate passes', () => {
    const { baseline, candidate } = pairedResults()
    const select = (run) =>
      run.samples.filter(
        (sample) =>
          sample.fixture === 'ordinary' &&
          sample.views === 'single' &&
          sample.scenario === 'typing' &&
          sample.repetition < 2,
      )
    const samples = { baseline: select(baseline), candidate: select(candidate) }
    const budget = inputBudget('native', 'ordinary/single/typing/inputToApplied').noiseMarginMs
    for (const [index, sample] of samples.candidate.entries())
      sample.latencyMs.inputToApplied = sample.latencyMs.inputToApplied.map(
        (value) => value + (index === 0 ? budget * 0.75 : -budget * 0.75),
      )
    expect(canStopInputPairs(samples, 'native')).toBe(false)
  })

  it('ignores advisory delays when deciding to complete the first block', () => {
    const { baseline, candidate } = pairedResults()
    delayScreenshots(candidate, 100)
    const select = (run) =>
      run.samples.filter(
        (sample) =>
          sample.fixture === 'ordinary' &&
          sample.views === 'single' &&
          sample.scenario === 'typing' &&
          sample.repetition < 2,
      )
    expect(
      canStopInputPairs({ baseline: select(baseline), candidate: select(candidate) }, 'native'),
    ).toBe(true)
  })

  it('passes identical products and reports all 108 blocking and 36 advisory groups', () => {
    const { baseline, candidate, schedule } = pairedResults(10, 60061)
    const check = comparePairedInput(baseline, candidate, schedule, 60061)
    expect(check.passed).toBe(true)
    expect(check.metrics[0].interval.draws).toBe(10_000)
    expect(check.metrics.filter((metric) => metric.blocking)).toHaveLength(108)
    expect(check.metrics.filter((metric) => !metric.blocking)).toHaveLength(36)
    expect(
      check.metrics.every((metric) => metric.differenceMs === 0 && metric.interval.lowMs === 0),
    ).toBe(true)
  })

  it('detects injected delay and accepts changed product bytes', () => {
    const { baseline, candidate, schedule } = pairedResults(30, 60061)
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
    expect(pairedInterval([20, 20], 17).lowMs).toBe(20)
    expect(() => pairedInterval([20], 17)).toThrow(/two/)
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
      run.samples = [10, 110, 510, 1010].flatMap((duration, repetition) =>
        result(run.id, duration)
          .samples.filter((sample) => sample.repetition === 0)
          .map((sample) => ({ ...sample, repetition })),
      )
    }
    const check = comparePairedInput(baseline, candidate, schedule, 17)
    expect(check.passed).toBe(true)
    expect(
      check.metrics.every((metric) => metric.differences.length === 4 && metric.differenceMs === 0),
    ).toBe(true)
  })

  it('requires the budget and confidence conditions together', () => {
    const { baseline, candidate, schedule } = pairedResults()
    candidate.samples = [11, 11, 11, 9].flatMap((duration, repetition) =>
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
      [candidate, 0.01],
    ]) {
      run.samples = [10, 11, 10, 11].flatMap((duration, repetition) =>
        result(run.id, duration + delay)
          .samples.filter((sample) => sample.repetition === 0)
          .map((sample) => ({ ...sample, repetition })),
      )
    }
    const check = comparePairedInput(baseline, candidate, schedule, 17)
    expect(check.passed).toBe(true)
    const dispatch = check.metrics.find((metric) => metric.key.endsWith('/dispatch'))
    expect(dispatch.differenceMs).toBeCloseTo(0.01)
    expect(dispatch.interval.lowMs).toBeCloseTo(0.01)
    expect(dispatch.budgetMs).toBe(inputBudget('native', dispatch.key).noiseMarginMs)
  })

  it('keeps frozen budgets when the baseline envelope widens', () => {
    const { baseline, candidate, schedule } = pairedResults()
    for (const [run, delay] of [
      [baseline, 0],
      [candidate, 9],
    ]) {
      run.samples = [10, 110, 510, 1010].flatMap((duration, repetition) =>
        result(run.id, duration + delay)
          .samples.filter((sample) => sample.repetition === 0)
          .map((sample) => ({ ...sample, repetition })),
      )
    }
    const check = comparePairedInput(baseline, candidate, schedule, 17)
    const metric = check.metrics.find(
      (value) => value.key === 'ordinary/single/composition-update/inputToFrame',
    )
    expect(metric.budgetMs).toBe(5.899999998509884)
    expect(metric.differenceMs).toBe(9)
    expect(metric.interval.lowMs).toBe(9)
    expect(metric.passed).toBe(false)
  })

  it('requires frame sensitivity to reject every frame key', () => {
    const { baseline, candidate, schedule } = pairedResults(30)
    const check = comparePairedInput(baseline, candidate, schedule, 17)
    expect(sensitivityPassed(check, 'frame')).toBe(true)
    check.metrics.find(
      (metric) => metric.key === 'ordinary/single/composition-update/inputToFrame',
    ).passed = true
    expect(sensitivityPassed(check, 'input')).toBe(true)
    expect(sensitivityPassed(check, 'frame')).toBe(false)
  })
  it.each(['inputToApplied', 'dispatch'])('requires every %s input sensitivity key', (measure) => {
    const { baseline, candidate, schedule } = pairedResults(30)
    const check = comparePairedInput(baseline, candidate, schedule, 17)
    check.metrics.find((metric) => metric.key === `long-line/multiple/paste/${measure}`).passed =
      true
    expect(sensitivityPassed(check, 'input')).toBe(false)
    expect(sensitivityPassed(check, 'frame')).toBe(true)
  })
  it('rejects absent sensitivity keys and unknown stages', () => {
    const { baseline, candidate, schedule } = pairedResults(30)
    const check = comparePairedInput(baseline, candidate, schedule, 17)
    check.metrics = check.metrics.filter(
      (metric) => metric.key !== 'ordinary/single/typing/inputToFrame',
    )
    expect(sensitivityPassed(check, 'frame')).toBe(false)
    expect(() => sensitivityPassed(check, 'unknown')).toThrow(/Unknown input sensitivity stage/)
  })
  it('admits only the named native frame key with a separately rejected floor', () => {
    const { baseline, candidate, schedule } = pairedResults(30)
    const check = comparePairedInput(baseline, candidate, schedule, 17)
    const floor = structuredClone(check)
    const metric = check.metrics.find((metric) => metric.key === frameDetectionFloorKey)
    metric.passed = true
    expect(sensitivityPassed(check, 'frame')).toBe(false)
    expect(sensitivityPassed(check, 'frame', floor)).toBe(true)
    expect(metric.blocking).toBe(true)
    expect(metric.budgetMs).toBe(inputBudget('native', frameDetectionFloorKey).noiseMarginMs)
    metric.budget.reference = 'disabled'
    expect(sensitivityPassed(check, 'frame', floor)).toBe(false)
    metric.budget.reference = 'native'
    check.metrics.find((metric) => metric.key === 'ordinary/single/typing/inputToFrame').passed =
      true
    expect(sensitivityPassed(check, 'frame', floor)).toBe(false)
    check.metrics = check.metrics.filter((metric) => metric.key !== frameDetectionFloorKey)
    expect(sensitivityPassed(check, 'frame', floor)).toBe(false)
  })

  it('keeps a missed 20 ms key blocking and requires raw 25 or 30 ms rejection', () => {
    const stored = sensitivityCache()
    const weaken = (check) => {
      for (const sample of check.candidate.samples) {
        if (
          sample.fixture !== 'ordinary' ||
          sample.views !== 'multiple' ||
          sample.scenario !== 'repeat'
        )
          continue
        Object.assign(sample, observations(sample.scenario, 22, sample.views))
      }
    }
    weaken(stored.controls.frame)
    const before = comparePairedInput(
      stored.controls.frame.baseline,
      stored.controls.frame.candidate,
      stored.controls.frame.schedule,
      17,
      200,
    )
    expect(before.metrics.find((metric) => metric.key === frameDetectionFloorKey).passed).toBe(true)
    expect(verifyInputSensitivity(stored, 'b'.repeat(64), 200)).toBe(stored)
    weaken(stored.frameDetectionFloor.attempts[0])
    expect(() => verifyInputSensitivity(stored, 'b'.repeat(64), 200)).toThrow(/stage sensitivity/)
    const next = structuredClone(sensitivityCache().frameDetectionFloor.attempts[0])
    next.candidate.config.frameSlowdownMs = 30
    stored.frameDetectionFloor = {
      key: frameDetectionFloorKey,
      delayMs: 30,
      attempts: [...stored.frameDetectionFloor.attempts, next],
    }
    expect(verifyInputSensitivity(stored, 'b'.repeat(64), 200)).toBe(stored)
  })

  it('reuses controls after assertion-only edits and invalidates them after timing-path edits', () => {
    const sources = [
      { path: 'examples/stress/src/inputLatency.ts', bytes: 'native capture and frame marks' },
      { path: 'examples/stress/input-output.mjs', bytes: 'assert rendered output' },
      { path: 'examples/stress/src/input-output.ts', bytes: 'read rendered output' },
    ]
    const original = inputSourceIdentity(sources, 'a'.repeat(64))
    const stored = sensitivityCache()
    stored.measurementHash = original.measurementHash
    stored.validationHash = original.validationHash
    for (const control of [
      stored.controls.input,
      stored.controls.frame,
      ...stored.frameDetectionFloor.attempts,
    ]) {
      for (const run of [control.baseline, control.candidate]) {
        run.environment.measurementHash = original.measurementHash
        run.environment.validationHash = original.validationHash
      }
    }
    for (const path of [
      'examples/stress/input-output.mjs',
      'examples/stress/src/input-output.ts',
    ]) {
      const changed = inputSourceIdentity(
        sources.map((source) =>
          source.path === path ? { ...source, bytes: source.bytes + ' changed predicate' } : source,
        ),
        'a'.repeat(64),
      )
      expect(changed.validationHash).not.toBe(original.validationHash)
      expect(changed.measurementHash).toBe(original.measurementHash)
      expect(verifyInputSensitivity(stored, changed.measurementHash, 200)).toBe(stored)
      expect(stored.validationHash).toBe(original.validationHash)
    }
    const timing = inputSourceIdentity(
      sources.map((source) =>
        source.path.endsWith('inputLatency.ts')
          ? { ...source, bytes: source.bytes + ' changed delay' }
          : source,
      ),
      'a'.repeat(64),
    )
    expect(timing.measurementHash).not.toBe(original.measurementHash)
    expect(() => verifyInputSensitivity(stored, timing.measurementHash, 200)).toThrow(
      /Invalid stored/,
    )
  })

  it('recomputes raw stage controls and validates the first rejected floor', () => {
    const stored = sensitivityCache()
    expect(verifyInputSensitivity(stored, 'b'.repeat(64), 200)).toBe(stored)
    stored.controls.frame.comparison.passed = true
    stored.frameDetectionFloor.attempts[0].comparison.passed = true
    expect(verifyInputSensitivity(stored, 'b'.repeat(64), 200)).toBe(stored)
    stored.frameDetectionFloor.delayMs = 30
    expect(() => verifyInputSensitivity(stored, 'b'.repeat(64), 200)).toThrow(/detection floor/)
  })

  it.each([
    'wrong-key',
    'wrong-delay',
    'different-products',
    'different-instrument',
    'missing-control',
    'missing-floor',
  ])('rejects %s cached control evidence', (fault) => {
    const stored = sensitivityCache()
    if (fault === 'wrong-key')
      stored.frameDetectionFloor.key = 'ordinary/single/typing/inputToFrame'
    if (fault === 'wrong-delay') stored.controls.frame.candidate.config.frameSlowdownMs = 25
    if (fault === 'different-products')
      stored.frameDetectionFloor.attempts[0].candidate.environment.packageSet.buildHash =
        'f'.repeat(64)
    if (fault === 'different-instrument')
      stored.controls.frame.candidate.environment.instrumentHash = 'f'.repeat(64)
    if (fault === 'missing-control') delete stored.controls.frame
    if (fault === 'missing-floor') delete stored.frameDetectionFloor
    expect(() => verifyInputSensitivity(stored, 'b'.repeat(64), 200)).toThrow(/stored|Stored/)
  })

  it('normalizes only injected stage controls while checking comparability', () => {
    const { baseline, candidate, schedule } = pairedResults(30)
    candidate.config.frameSlowdownMs = 20
    expect(comparePairedInput(baseline, candidate, schedule, 17).passed).toBe(false)
    baseline.config.frameSlowdownMs = 1
    expect(() => comparePairedInput(baseline, candidate, schedule, 17)).toThrow(
      /baseline must have no injected delay/,
    )
  })

  it('stops only complete tight pairs within every frozen gating budget', () => {
    const { baseline, candidate } = pairedResults()
    for (const group of baseline.samples.filter((sample) => sample.repetition === 0)) {
      const select = (run) =>
        run.samples.filter(
          (sample) =>
            sample.fixture === group.fixture &&
            sample.views === group.views &&
            sample.scenario === group.scenario &&
            sample.repetition < 2,
        )
      const samples = { baseline: select(baseline), candidate: select(candidate) }
      expect(canStopInputPairs(samples, 'native')).toBe(true)
      for (const sample of samples.candidate)
        sample.latencyMs.dispatch = sample.latencyMs.dispatch.map((value) => value + 20)
      expect(canStopInputPairs(samples, 'native')).toBe(false)
    }
    expect(canStopInputPairs({ baseline: [], candidate: [] }, 'native')).toBe(false)
  })

  it('admits declared complete two-pair groups and rejects unjustified stopping', () => {
    const { baseline, candidate, schedule } = pairedResults()
    for (const run of [baseline, candidate]) {
      run.samples = run.samples.filter((sample) => sample.repetition < 2)
      run.config.adaptivePairs = 'counterbalanced-tight-within-budget'
      run.config.groupRepetitions = Object.fromEntries(
        run.samples.map((sample) => [`${sample.fixture}/${sample.views}/${sample.scenario}`, 2]),
      )
    }
    const pairs = schedule.filter((pair) => pair.repetition < 2)
    const check = comparePairedInput(baseline, candidate, pairs, 17)
    expect(check.passed).toBe(true)
    expect(check.metrics.every((metric) => metric.differences.length === 2)).toBe(true)
    candidate.samples[0] = result(candidate.id, 30).samples[0]
    expect(() => comparePairedInput(baseline, candidate, pairs, 17)).toThrow(/adaptive early stop/)
  })

  it('keeps fixed repetition bounds even with undeclared group counts', () => {
    const { baseline } = pairedResults()
    const sample = baseline.samples[0]
    const key = `${sample.fixture}/${sample.views}/${sample.scenario}`
    baseline.config.groupRepetitions = { [key]: 6 }
    sample.repetition = 4
    expect(() => validateInputResult(baseline)).toThrow(/Invalid sample repetition/)
  })

  it('rejects missing or invalid adaptive group declarations', () => {
    const { baseline, candidate, schedule } = pairedResults()
    baseline.config.adaptivePairs = 'counterbalanced-tight-within-budget'
    baseline.config.groupRepetitions = {}
    expect(() => comparePairedInput(baseline, candidate, schedule, 17)).toThrow(
      /adaptive group counts/,
    )
    for (const run of [baseline, candidate]) {
      run.config.adaptivePairs = 'counterbalanced-tight-within-budget'
      run.config.groupRepetitions = Object.fromEntries(
        run.samples.map((sample) => [`${sample.fixture}/${sample.views}/${sample.scenario}`, 1]),
      )
    }
    expect(() => comparePairedInput(baseline, candidate, schedule, 17)).toThrow(
      /adaptive repetition count/,
    )
  })

  it('declares native inheritance and rejects unknown budgets', () => {
    const key = 'ordinary/single/typing/dispatch'
    expect(inputBudget('platform', key)).toMatchObject({
      inherited: true,
      reference: 'native',
      noiseMarginMs: inputBudget('native', key).noiseMarginMs,
    })
    expect(() => inputBudget('unknown', key)).toThrow('Missing frozen input budget')
    expect(() => inputBudget('native', 'missing')).toThrow('Missing frozen input budget')
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

  it('uses the shipping composition and native quiet default', () => {
    expect(inputMatrixConfigurations()).toEqual(['platform', 'native'])
    expect(inputMatrixConfigurations({ declared: ['native', 'shiki', 'shiki'] })).toEqual([
      'platform',
      'native',
      'shiki',
    ])
  })
})

function warmResult() {
  const run = result()
  run.config.isolation = 'closed-browser-context-per-configuration'
  run.config.warmupFixture = 'measured'
  run.bootstrap = structuredClone(run.samples[0])
  run.bootstrap.repetition = -1
  run.bootstrap.wallMs = 100
  run.bootstrap.cleanup.afterListeners = 10
  run.cleanup = {
    ...run.samples[0].cleanup,
    scope: 'configuration',
    ownerIdentity: 'warm-owner',
    trackedObjects: 15,
  }
  run.startup = inputViewModes.flatMap((views) =>
    run.manifest.fixtures.map((fixture) => ({
      fixture: fixture.id,
      views,
      ownerIdentity: 'warm-owner',
      retained: views !== 'single' || fixture.id !== 'ordinary',
      milliseconds: 100,
    })),
  )
  for (const sample of run.samples) {
    sample.cleanup = null
    sample.reset = {
      ownerIdentity: 'warm-owner',
      fixtureHash: sample.fixtureHash,
      length: 10,
      views: sample.views === 'multiple' ? 3 : 1,
      hiddenViews: sample.views === 'multiple' ? 1 : 0,
      cursor: { row: 0, column: 0 },
      historyEmpty: true,
      sourceCurrent: true,
      milliseconds: 1,
      documentReloaded: false,
      rejectedSource: null,
    }
  }
  return run
}

describe('warm configuration lifecycle', () => {
  it('requires complete startup, reset and final disposal receipts', () => {
    expect(validateInputResult(warmResult())).toBeTruthy()
  })
  it.each([2, 4])('rejects bootstrap ownership count %s', (trackedObjects) => {
    const run = warmResult()
    run.bootstrap.cleanup.trackedObjects = trackedObjects
    expect(() => validateInputResult(run)).toThrow(/bootstrap cleanup trackedObjects/)
  })
  it('rejects a missing shared analysis in final ownership accounting', () => {
    const run = warmResult()
    run.cleanup.trackedObjects = 14
    expect(() => validateInputResult(run)).toThrow(/tracked configuration objects/)
  })
  it('rejects a missing initialization receipt', () => {
    const run = warmResult()
    delete run.bootstrap
    expect(() => validateInputResult(run)).toThrow(/bootstrap/)
  })
  it('binds lifetime counts to the disposed initialization receipt', () => {
    const run = warmResult()
    run.cleanup.beforeListeners += 1
    expect(() => validateInputResult(run)).toThrow(/initialized listener baseline/)
  })
  it('rejects a retained initialization owner', () => {
    const run = warmResult()
    run.bootstrap.cleanup.retainedObjects = 1
    expect(() => validateInputResult(run)).toThrow(/bootstrap cleanup retainedObjects/)
  })
  it('rejects an owner replaced between bursts', () => {
    const run = warmResult()
    run.samples[0].reset.ownerIdentity = 'replacement'
    expect(() => validateInputResult(run)).toThrow(/retained input owner/)
  })
  it.each(['historyEmpty', 'sourceCurrent'])('rejects an incomplete reset %s', (field) => {
    const run = warmResult()
    run.samples[0].reset[field] = false
    expect(() => validateInputResult(run)).toThrow(/reset/)
  })
  it('rejects skipped subject startup proof', () => {
    const run = warmResult()
    run.startup.pop()
    expect(() => validateInputResult(run)).toThrow(/startup coverage/)
  })
  it('rejects configuration listener growth', () => {
    const run = warmResult()
    run.cleanup.afterListeners = run.cleanup.beforeListeners + 1
    expect(() => validateInputResult(run)).toThrow(/cleanup counts/)
  })
  it('admits a reload only for the observed pending minimap source exception', () => {
    const run = warmResult()
    run.config.pendingMinimapSource = true
    const sample = run.samples.find(
      (entry) => entry.fixture === 'short-lines' && entry.scenario === 'undo',
    )
    sample.reset.documentReloaded = true
    sample.reset.rejectedSource = [{ current: false, renderedAfterSource: true }]
    expect(validateInputResult(run)).toBeTruthy()
    sample.reset.rejectedSource[0].current = true
    expect(() => validateInputResult(run)).toThrow(/rejected source receipt/)
  })
  it('keeps an already current source warm without a document reload', () => {
    const run = warmResult()
    run.config.pendingMinimapSource = true
    expect(validateInputResult(run)).toBeTruthy()
    run.samples[0].reset.documentReloaded = true
    expect(() => validateInputResult(run)).toThrow(/Unadmitted/)
  })
})

describe('declared loaded Tree-sitter policy', () => {
  it('raises exactly 61 blocking margins and preserves every other margin', () => {
    const { baseline, candidate, schedule } = pairedResults()
    for (const run of [baseline, candidate]) {
      run.config.consumers = 'tree-sitter'
      run.config.loadProfile = 'loaded'
    }
    const check = comparePairedInput(baseline, candidate, schedule, 17)
    expect(check.metrics.filter((metric) => metric.blocking)).toHaveLength(108)
    expect(
      check.metrics.filter((metric) => metric.blocking && metric.frozenBudgetMs < 5),
    ).toHaveLength(61)
    expect(
      check.metrics.filter((metric) => metric.blocking && metric.frozenBudgetMs < 1),
    ).toHaveLength(20)
    for (const metric of check.metrics) {
      expect(metric.frozenBudgetMs).toBe(inputBudget('tree-sitter', metric.key).noiseMarginMs)
      expect(metric.budgetMs).toBe(
        metric.blocking ? Math.max(metric.frozenBudgetMs, 5) : metric.frozenBudgetMs,
      )
      expect(metric.budget.reason).toBe(
        metric.blocking && metric.frozenBudgetMs < 5
          ? 'Declared loaded Tree-sitter contention floor: 5 ms'
          : 'Frozen historical margin',
      )
      for (const configuration of ['native', 'disabled', 'shiki', 'minimap', 'shiki-minimap'])
        expect(inputBudget(configuration, metric.key, 'loaded').noiseMarginMs).toBe(
          inputBudget(configuration, metric.key).noiseMarginMs,
        )
    }
  })

  it.each(['tree-sitter-shiki', 'tree-sitter-minimap', 'all', 'platform'])(
    'raises 62 blocking margins for loaded %s and keeps its frozen provenance',
    (configuration) => {
      const { baseline, candidate, schedule } = pairedResults()
      for (const run of [baseline, candidate]) {
        run.config.consumers = configuration
        run.config.loadProfile = 'loaded'
      }
      const check = comparePairedInput(baseline, candidate, schedule, 17)
      expect(check.metrics.filter((metric) => metric.blocking)).toHaveLength(108)
      expect(
        check.metrics.filter((metric) => metric.blocking && metric.frozenBudgetMs < 5),
      ).toHaveLength(62)
      expect(
        check.metrics.filter((metric) => metric.blocking && metric.frozenBudgetMs < 1),
      ).toHaveLength(17)
      for (const metric of check.metrics) {
        const frozen = inputBudget(configuration, metric.key)
        expect(metric.frozenBudgetMs).toBe(frozen.noiseMarginMs)
        expect(metric.budgetMs).toBe(
          metric.blocking ? Math.max(metric.frozenBudgetMs, 5) : metric.frozenBudgetMs,
        )
        expect(metric.budget.sha256).toBe(frozen.sha256)
        expect(metric.budget.reference).toBe('native')
        expect(metric.budget.inherited).toBe(true)
        expect(metric.budget.reason).toBe(
          metric.blocking && metric.frozenBudgetMs < 5
            ? 'Declared loaded Tree-sitter contention floor: 5 ms'
            : 'Frozen historical margin',
        )
      }
      const fine = check.metrics.find((metric) => metric.blocking && metric.frozenBudgetMs < 1)
      for (const run of [baseline, candidate]) run.config.loadProfile = 'quiet'
      const quiet = comparePairedInput(baseline, candidate, schedule, 17).metrics.find(
        (metric) => metric.key === fine.key,
      )
      expect(quiet.budgetMs).toBe(fine.frozenBudgetMs)
      expect(quiet.blocking).toBe(true)
    },
  )

  it.each(['tree-sitter-shiki', 'tree-sitter-minimap', 'all', 'platform'])(
    'keeps twenty-millisecond synthetic stage regressions rejecting for loaded %s',
    (configuration) => {
      const { baseline, candidate, schedule } = pairedResults(30)
      for (const run of [baseline, candidate]) {
        run.config.consumers = configuration
        run.config.loadProfile = 'loaded'
      }
      const check = comparePairedInput(baseline, candidate, schedule, 17)
      expect(sensitivityPassed(check, 'input')).toBe(true)
      expect(sensitivityPassed(check, 'frame')).toBe(true)
    },
  )

  it('retains quiet sub-ms rejection and reports the declared applied floor', () => {
    const { baseline, candidate, schedule } = pairedResults(11)
    for (const run of [baseline, candidate]) run.config.consumers = 'tree-sitter'
    const key = 'short-lines/single/undo/dispatch'
    const quiet = comparePairedInput(baseline, candidate, schedule, 17).metrics.find(
      (metric) => metric.key === key,
    )
    expect(quiet.blocking).toBe(true)
    expect(quiet.passed).toBe(false)
    expect(quiet.budgetMs).toBe(inputBudget('tree-sitter', key).noiseMarginMs)
    for (const run of [baseline, candidate]) run.config.loadProfile = 'loaded'
    const loaded = comparePairedInput(baseline, candidate, schedule, 17).metrics.find(
      (metric) => metric.key === key,
    )
    expect(loaded.blocking).toBe(true)
    expect(loaded.passed).toBe(true)
    expect(loaded.frozenBudgetMs).toBe(quiet.budgetMs)
    expect(loaded.budgetMs).toBe(5)
    expect(loaded.budget.sha256).toBe(quiet.budget.sha256)
  })

  it('keeps actual-stage twenty-millisecond synthetic regressions rejecting', () => {
    const { baseline, candidate, schedule } = pairedResults(30)
    for (const run of [baseline, candidate]) {
      run.config.consumers = 'tree-sitter'
      run.config.loadProfile = 'loaded'
    }
    const check = comparePairedInput(baseline, candidate, schedule, 17)
    expect(sensitivityPassed(check, 'input')).toBe(true)
    expect(sensitivityPassed(check, 'frame')).toBe(true)
  })

  it('uses the declared applied margins for the unchanged first-block guard', () => {
    const { baseline, candidate } = pairedResults()
    const select = (run) =>
      run.samples.filter(
        (sample) =>
          sample.fixture === 'short-lines' &&
          sample.views === 'single' &&
          sample.scenario === 'undo' &&
          sample.repetition < 2,
      )
    const samples = { baseline: select(baseline), candidate: select(candidate) }
    for (const [index, sample] of samples.candidate.entries())
      for (const metric of ['inputToApplied', 'dispatch', 'inputToFrame'])
        sample.latencyMs[metric] = sample.latencyMs[metric].map((value) => value + 2 + index)
    expect(canStopInputPairs(samples, 'tree-sitter', 'quiet')).toBe(false)
    expect(canStopInputPairs(samples, 'tree-sitter', 'loaded')).toBe(true)
  })

  it('rejects missing, unknown or mismatched declared profiles', () => {
    const { baseline, candidate, schedule } = pairedResults()
    delete baseline.config.loadProfile
    delete candidate.config.loadProfile
    expect(() => comparePairedInput(baseline, candidate, schedule, 17)).toThrow(
      /Missing paired input load profile/,
    )
    baseline.config.loadProfile = candidate.config.loadProfile = 'unknown'
    expect(() => comparePairedInput(baseline, candidate, schedule, 17)).toThrow(
      /Unknown input load profile/,
    )
    baseline.config.loadProfile = 'quiet'
    candidate.config.loadProfile = 'loaded'
    expect(() => comparePairedInput(baseline, candidate, schedule, 17)).toThrow(/workload options/)
    expect(() => inputBudget('tree-sitter', 'short-lines/single/undo/dispatch', 'unknown')).toThrow(
      /Unknown input load profile/,
    )
  })

  it('includes loaded worker-backed Tree-sitter only in full or focused verification', () => {
    expect(inputMatrixConfigurations({ loadProfile: 'loaded' })).toEqual(['native', 'disabled'])
    expect(inputMatrixConfigurations({ loadProfile: 'loaded', full: true })).toEqual([
      'native',
      'disabled',
      'tree-sitter',
      'shiki',
      'minimap',
      'tree-sitter-shiki',
      'tree-sitter-minimap',
      'shiki-minimap',
      'all',
      'platform',
    ])
    expect(
      inputMatrixConfigurations({
        loadProfile: 'loaded',
        declared: ['tree-sitter', 'tree-sitter-shiki', 'tree-sitter-minimap', 'all', 'native'],
      }),
    ).toEqual(['native', 'disabled'])
    expect(
      inputMatrixConfigurations({
        loadProfile: 'loaded',
        only: true,
        declared: ['tree-sitter', 'tree-sitter-shiki', 'tree-sitter-minimap', 'all', 'platform'],
      }),
    ).toEqual(['tree-sitter', 'tree-sitter-shiki', 'tree-sitter-minimap', 'all', 'platform'])
  })
})
