import { describe, expect, it } from 'vitest'
import { calibrate, compare, scenarios, states, validateResult } from '../results.mjs'

function result(id = 'control-1', duration = 10) {
  const fixture = { id: 'ordinary', sha256: 'a'.repeat(64) }
  return {
    schemaVersion: 1,
    id,
    environment: {
      commit: 'abc',
      sourceHash: 'def',
      browser: { version: '1' },
      hardware: { cpu: 'reference' },
    },
    config: { repetitions: 3, warmups: 1, scenarios, typedText: 'ab', diagnostics: false },
    manifest: { schemaVersion: 1, fixtures: [fixture] },
    samples: scenarios.flatMap((scenario: string) =>
      states.flatMap((state: string) =>
        Array.from({ length: 3 }, (_, repetition) => ({
          fixture: fixture.id,
          fixtureHash: fixture.sha256,
          scenario,
          state,
          repetition,
          latencyMs: latencies(scenario, duration),
          correct: true,
          observation: { checked: true },
          cleanup: {
            active: false,
            hosts: 0,
            pendingFrames: 0,
            trackedObjects: scenario === 'churn' ? 4 : 2,
            retainedObjects: 0,
          },
          memory: { status: 'unsupported', reason: 'unit fixture' },
        })),
      ),
    ),
  }
}

function latencies(scenario: string, duration: number): Record<string, number[]> {
  if (scenario === 'typing')
    return {
      keyToApplied: [duration, duration],
      keyToFrame: [duration, duration],
      burstToPaintUpperBound: [duration],
    }
  if (scenario === 'jump') return { commandToPaintUpperBound: [duration] }
  if (scenario === 'find-all') return { queryToCount: [duration] }
  if (scenario === 'scroll') return { wheelToPaintUpperBound: Array(5).fill(duration) }
  if (scenario === 'churn') return { editDelete: [duration] }
  return {
    attach: [duration],
    visibleTextUpperBound: [duration],
    highlightedPaintUpperBound: [duration],
  }
}

describe('benchmark comparisons', () => {
  it('accepts an unchanged rerun and detects a deliberate slowdown', () => {
    const baseline = result()
    const calibration = calibrate([baseline, result('control-2', 11), result('control-3', 9)])
    expect(compare(baseline, result('rerun'), calibration).passed).toBe(true)
    expect(compare(baseline, result('slow', 100), calibration).passed).toBe(false)
  })

  it('rejects missing samples and missing per-key measurements', () => {
    const missing = result()
    missing.samples.pop()
    expect(() => validateResult(missing)).toThrow(/Missing samples/)
    const keys = result()
    keys.samples.find((sample) => sample.scenario === 'typing')!.latencyMs.keyToApplied!.pop()
    expect(() => validateResult(keys)).toThrow(/Missing keyToApplied/)
  })

  it('rejects hashes and configuration changes before interpreting timings', () => {
    const baseline = result()
    const calibration = calibrate([baseline, result('b'), result('c')])
    const changed = result('changed')
    changed.manifest.fixtures[0]!.sha256 = 'b'.repeat(64)
    expect(() => compare(baseline, changed, calibration)).toThrow(/hash/)
    const options = result('options')
    options.config.diagnostics = true
    expect(() => compare(baseline, options, calibration)).toThrow(/options/)
    const browser = result('browser')
    browser.environment.browser.version = '2'
    expect(() => compare(baseline, browser, calibration)).toThrow(/browser/)
  })

  it('rejects a missing metric and detects increased retained memory', () => {
    const missing = result()
    delete missing.samples[0]!.latencyMs.attach
    expect(() => validateResult(missing)).toThrow(/coverage/)
    const baseline = supportedResult('a', 100)
    const calibration = calibrate([baseline, supportedResult('b', 101), supportedResult('c', 99)])
    expect(compare(baseline, supportedResult('rerun', 100), calibration).passed).toBe(true)
    const retained = compare(baseline, supportedResult('retained', 1000), calibration)
    expect(retained.metrics.every((metric: { passed: boolean }) => metric.passed)).toBe(true)
    expect(retained.passed).toBe(false)
  })

  it('rejects a missing post-churn snapshot from one repetition', () => {
    const candidate = supportedResult('missing-post-churn', 100)
    const sample = candidate.samples.find((sample) => sample.scenario === 'churn')!
    delete sample.memory.postChurn
    expect(() => validateResult(candidate)).toThrow(/Missing post-churn memory/)
  })

  it('rejects a memory capability change for one repetition', () => {
    const baseline = supportedResult('a', 100)
    const calibration = calibrate([baseline, supportedResult('b', 101), supportedResult('c', 99)])
    const candidate = {
      ...supportedResult('missing-memory', 100),
      samples: baseline.samples.map((sample, index) => ({
        ...sample,
        memory:
          index === 0
            ? { status: 'unsupported', reason: 'Measurement unavailable' }
            : sample.memory,
      })),
    }
    expect(() => compare(baseline, candidate, calibration)).toThrow(/memory capabilities/)
    expect(() => calibrate([baseline, candidate, supportedResult('c', 99)])).toThrow(
      /memory capabilities/,
    )
  })

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, -1, 0.5])(
    'rejects invalid retained object count %s',
    (retainedObjects) => {
      const baseline = supportedResult('invalid-retention', 100)
      const candidate = {
        ...baseline,
        samples: baseline.samples.map((sample) => ({
          ...sample,
          cleanup: { ...sample.cleanup, retainedObjects },
        })),
      }
      expect(() => validateResult(candidate)).toThrow(/retained objects/)
    },
  )

  it('rejects duplicate, nonfinite, failed and uncalibrated results', () => {
    const duplicate = result()
    duplicate.samples.push(duplicate.samples[0]!)
    expect(() => validateResult(duplicate)).toThrow(/Duplicate/)
    expect(() => validateResult(result('invalid', Number.NaN))).toThrow(/invalid/)
    const failed = result()
    failed.samples[0]!.correct = false
    expect(() => validateResult(failed)).toThrow(/correctness/)
    expect(() => calibrate([result()])).toThrow(/three/)
    expect(() => calibrate([result(), result(), result()])).toThrow(/distinct/)
    expect(() =>
      calibrate([
        result(),
        { ...result('b'), environment: { ...result().environment, sourceHash: 'changed' } },
        result('c'),
      ]),
    ).toThrow(/source trees/)
  })
})

function supportedResult(id: string, usedBytes: number) {
  const run = result(id)
  return {
    ...run,
    samples: run.samples.map((sample) => ({
      ...sample,
      memory: {
        status: 'supported',
        before: memorySnapshot(100),
        after: memorySnapshot(usedBytes),
        ...(sample.scenario === 'churn' ? { postChurn: memorySnapshot(usedBytes) } : {}),
      },
    })),
  }
}

function memorySnapshot(usedBytes: number) {
  return { usedBytes, totalBytes: 2000, nodes: 20, documents: 1, jsEventListeners: 3 }
}
