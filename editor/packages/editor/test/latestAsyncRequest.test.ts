import { afterEach, describe, expect, it, vi } from 'vitest'

import { LatestAsyncRequest } from '../src/editor/latestAsyncRequest'

type Deferred<T> = {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function flushSchedulerTicks(count = 4): void {
  for (let index = 0; index < count; index += 1) vi.runOnlyPendingTimers()
}

describe('LatestAsyncRequest', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('applies only the latest request result', async () => {
    vi.useFakeTimers()
    const first = createDeferred<string>()
    const second = createDeferred<string>()
    const applied: string[] = []
    const request = new LatestAsyncRequest<string>()

    request.schedule({ run: () => first.promise, apply: (result) => applied.push(result) })
    request.schedule({ run: () => second.promise, apply: (result) => applied.push(result) })
    flushSchedulerTicks()

    first.resolve('first')
    await flushMicrotasks()
    expect(applied).toEqual([])

    second.resolve('second')
    await flushMicrotasks()
    expect(applied).toEqual(['second'])
  })

  it('replaces delayed requests before they start', async () => {
    vi.useFakeTimers()
    const started: string[] = []
    const applied: string[] = []
    const request = new LatestAsyncRequest<string>()

    request.schedule({
      delayMs: 75,
      run: async () => {
        started.push('first')
        return 'first'
      },
      apply: (result) => applied.push(result),
    })
    vi.advanceTimersByTime(50)
    request.schedule({
      delayMs: 75,
      run: async () => {
        started.push('second')
        return 'second'
      },
      apply: (result) => applied.push(result),
    })

    vi.advanceTimersByTime(74)
    expect(started).toEqual([])

    vi.advanceTimersByTime(1)
    flushSchedulerTicks()
    await flushMicrotasks()
    expect(started).toEqual(['second'])
    expect(applied).toEqual(['second'])
  })

  it('ignores stale request errors', async () => {
    vi.useFakeTimers()
    const first = createDeferred<string>()
    const second = createDeferred<string>()
    const failed: unknown[] = []
    const applied: string[] = []
    const request = new LatestAsyncRequest<string>()

    request.schedule({
      run: () => first.promise,
      apply: (result) => applied.push(result),
      fail: (error) => failed.push(error),
    })
    flushSchedulerTicks(1)
    request.schedule({
      run: () => second.promise,
      apply: (result) => applied.push(result),
      fail: (error) => failed.push(error),
    })
    flushSchedulerTicks(1)

    first.reject(new Error('stale'))
    second.resolve('second')
    await flushMicrotasks()

    expect(failed).toEqual([])
    expect(applied).toEqual(['second'])
  })

  it('clears delayed work on dispose', async () => {
    vi.useFakeTimers()
    const started: string[] = []
    const request = new LatestAsyncRequest<string>()

    request.schedule({
      delayMs: 75,
      run: async () => {
        started.push('started')
        return 'done'
      },
      apply: () => undefined,
    })
    request.dispose()

    vi.advanceTimersByTime(75)
    expect(started).toEqual([])
  })
})
