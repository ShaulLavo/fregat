import { afterEach, expect, test, vi } from 'vitest'
import { awaitInputStage, waitForInputReady } from '../src/inputReadiness.ts'

afterEach(() => vi.useRealTimers())

const observe = () => ({ treePending: 1, shikiPending: 0 })

async function expired(promise, advance) {
  let outcome
  promise.then(
    () => {
      outcome = 'resolved'
    },
    (error) => {
      outcome = error
    },
  )
  await vi.advanceTimersByTimeAsync(advance)
  return outcome
}

test.each(['Tree-sitter idle fence', 'Shiki idle fence', 'Tree-sitter disposal', 'Shiki disposal'])(
  'bounds a never-resolving %s with its named pending state',
  async (stage) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const error = await expired(
      awaitInputStage(stage, performance.now() + 30, observe, () => new Promise(() => {})),
      31,
    )
    expect(error.message).toContain(stage)
    expect(error.internal).toEqual({ stage, pending: observe() })
    expect(vi.getTimerCount()).toBe(0)
  },
)

test('a readiness condition that stays false rejects instead of returning partial readiness', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  const error = await expired(
    waitForInputReady('initial highlights', performance.now() + 30, () => false, observe),
    33,
  )
  expect(error.message).toContain('initial highlights')
  expect(error.internal.pending).toEqual(observe())
  await vi.runAllTimersAsync()
  expect(vi.getTimerCount()).toBe(0)
})

test('successive stages share one deadline and successful stages cancel their timeout', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  const deadline = performance.now() + 30
  const first = awaitInputStage('first', deadline, observe, () => Promise.resolve('ready'))
  await expect(first).resolves.toBe('ready')
  expect(vi.getTimerCount()).toBe(0)
  await vi.advanceTimersByTimeAsync(20)
  const error = await expired(
    awaitInputStage('second', deadline, observe, () => new Promise(() => {})),
    11,
  )
  expect(error.message).toContain('second')
})

test('an expired deadline rejects before starting another consumer operation', async () => {
  const operation = vi.fn(() => Promise.resolve())
  await expect(
    awaitInputStage('expired fence', performance.now() - 1, observe, operation),
  ).rejects.toThrow('expired fence')
  expect(operation).not.toHaveBeenCalled()
})

test('a rejected consumer operation releases its deadline timer', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  const rejected = new TypeError('worker failed')
  await expect(
    awaitInputStage('rejected fence', performance.now() + 30, observe, () =>
      Promise.reject(rejected),
    ),
  ).rejects.toBe(rejected)
  expect(vi.getTimerCount()).toBe(0)
})
