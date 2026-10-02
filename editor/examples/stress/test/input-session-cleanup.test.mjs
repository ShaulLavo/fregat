import { runInNewContext } from 'node:vm'
import { expect, test } from 'vitest'
import * as scenarios from '../input-scenarios.mjs'

function session(events, side, retainedInput, closeFailure) {
  const world = {
    setTimeout: (fn) => fn(),
    __stress: {
      dispose: () => events.push(`${side}:dispose`),
      retention: () => ({
        active: false,
        hosts: 0,
        pendingFrames: 0,
        liveWorkers: 0,
        retainedObjects: 0,
        trackedObjects: 0,
      }),
    },
  }
  return {
    retainedInput,
    cdp: {},
    page: {
      evaluate: async (fn) => runInNewContext(`(${fn.toString()})()`, world),
      isClosed: () => events.includes(`${side}:close`),
    },
    context: {
      close: async () => {
        events.push(`${side}:close`)
        if (closeFailure) throw closeFailure
      },
    },
  }
}

test('first-subject failure disposes both pages without owner facts and preserves the original error', async () => {
  const events = []
  const original = { reason: 'first subject setup failed' }
  const sessions = {
    baseline: session(events, 'baseline', { beforeMemory: { jsEventListeners: 0 } }),
    candidate: session(events, 'candidate', { beforeMemory: { jsEventListeners: 0 } }),
  }
  const results = { baseline: {}, candidate: {} }
  await expect(
    scenarios.withInputSessionCleanup(
      sessions,
      results,
      async () => ({ jsEventListeners: 0 }),
      async () => {
        throw original
      },
    ),
  ).rejects.toBe(original)
  expect(events).toEqual(
    expect.arrayContaining([
      'baseline:dispose',
      'baseline:close',
      'candidate:dispose',
      'candidate:close',
    ]),
  )
  expect(results.baseline.cleanup.ownerIdentity).toBeNull()
  expect(results.candidate.cleanup.ownerIdentity).toBeNull()
})

test('a secondary cleanup error cannot hide setup failure or skip the other page', async () => {
  const events = []
  const original = { reason: 'setup failed' }
  const secondary = { reason: 'browser close failed' }
  const sessions = {
    baseline: session(events, 'baseline', undefined, secondary),
    candidate: session(events, 'candidate', undefined),
  }
  await expect(
    scenarios.withInputSessionCleanup(
      sessions,
      { baseline: {}, candidate: {} },
      async () => ({}),
      async () => {
        throw original
      },
    ),
  ).rejects.toBe(original)
  expect(events).toEqual(
    expect.arrayContaining([
      'baseline:dispose',
      'baseline:close',
      'candidate:dispose',
      'candidate:close',
    ]),
  )
})

test('cleanup failure after successful collection rejects after closing every page', async () => {
  const events = []
  const failure = { reason: 'browser close failed' }
  const sessions = {
    baseline: session(events, 'baseline', undefined, failure),
    candidate: session(events, 'candidate', undefined),
  }
  await expect(
    scenarios.withInputSessionCleanup(
      sessions,
      { baseline: {}, candidate: {} },
      async () => ({}),
      async () => 'success',
    ),
  ).rejects.toBe(failure)
  expect(events).toEqual(
    expect.arrayContaining([
      'baseline:dispose',
      'baseline:close',
      'candidate:dispose',
      'candidate:close',
    ]),
  )
})
