import { afterEach, describe, expect, it, vi } from 'vitest'

import { EditorWorkScheduler, type EditorWorkEvent } from '../src/editor/workScheduler'

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

describe('EditorWorkScheduler', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('yields through browser tasks and preserves queued priority without nested timers', () => {
    vi.useFakeTimers()
    const pending: Array<() => void> = []
    const calls: string[] = []
    vi.stubGlobal('scheduler', {
      postTask: (callback: () => void) => {
        pending.push(callback)
        return Promise.resolve()
      },
    })
    const scheduler = new EditorWorkScheduler()
    scheduler.schedule({
      key: 'folds',
      taskClass: 'background-derived',
      defer: true,
      run: () => calls.push('folds'),
    })
    scheduler.schedule({
      key: 'text',
      taskClass: 'visible-render',
      defer: true,
      run: () => calls.push('text'),
    })
    expect(calls).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
    pending.shift()!()
    expect(calls).toEqual(['text'])
    pending.shift()!()
    expect(calls).toEqual(['text', 'folds'])
    scheduler.dispose()
  })

  it('aborts the posted browser task when disposed before its slice starts', () => {
    let signal: AbortSignal | undefined
    const run = vi.fn()
    vi.stubGlobal('scheduler', {
      postTask: (_callback: () => void, options: SchedulerPostTaskOptions) => {
        signal = options.signal
        return Promise.resolve()
      },
    })
    const scheduler = new EditorWorkScheduler()
    scheduler.schedule({ key: 'folds', taskClass: 'background-derived', defer: true, run })
    scheduler.dispose()
    expect(signal?.aborted).toBe(true)
    expect(run).not.toHaveBeenCalled()
  })

  it('runs only the latest delayed work for a key', () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const events: EditorWorkEvent[] = []
    const scheduler = new EditorWorkScheduler({ onEvent: (event) => events.push(event) })

    scheduler.schedule({
      key: 'editor.syntax.visibleRange',
      taskClass: 'viewport-derived',
      delayMs: 50,
      tags: { version: 1, viewport: '0:10' },
      run: () => calls.push('first'),
    })
    vi.advanceTimersByTime(25)
    scheduler.schedule({
      key: 'editor.syntax.visibleRange',
      taskClass: 'viewport-derived',
      delayMs: 50,
      tags: { version: 2, viewport: '10:20' },
      run: () => calls.push('second'),
    })

    vi.advanceTimersByTime(49)
    expect(calls).toEqual([])

    vi.advanceTimersByTime(1)
    flushSchedulerTicks()
    expect(calls).toEqual(['second'])
    expect(events.map((event) => event.type)).toEqual([
      'scheduled',
      'cancelled',
      'scheduled',
      'started',
      'completed',
    ])
    expect(events.at(-1)).toMatchObject({
      key: 'editor.syntax.visibleRange',
      priority: 'normal',
      tags: { version: 2, viewport: '10:20' },
    })
  })

  it('drops stale work before it starts', () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const events: EditorWorkEvent[] = []
    const scheduler = new EditorWorkScheduler({ onEvent: (event) => events.push(event) })

    scheduler.schedule({
      key: 'editor.features',
      taskClass: 'background-derived',
      delayMs: 10,
      tags: { version: 1 },
      isCurrent: (tags) => tags.version === 2,
      run: () => calls.push('stale'),
    })

    vi.advanceTimersByTime(10)
    flushSchedulerTicks()
    expect(calls).toEqual([])
    expect(events.at(-1)).toMatchObject({ type: 'dropped', reason: 'stale-before-start' })
  })

  it('cancels running async work when replacement is scheduled', async () => {
    vi.useFakeTimers()
    const first = createDeferred<string>()
    const second = createDeferred<string>()
    const applied: string[] = []
    const captured: { firstSignal: AbortSignal | null } = { firstSignal: null }
    const scheduler = new EditorWorkScheduler()

    scheduler.schedule({
      key: 'editor.syntax.document',
      taskClass: 'background-derived',
      run: (context) => {
        captured.firstSignal = context.signal
        return first.promise
      },
      apply: (result) => applied.push(result),
    })
    flushSchedulerTicks(1)
    scheduler.schedule({
      key: 'editor.syntax.document',
      taskClass: 'background-derived',
      run: () => second.promise,
      apply: (result) => applied.push(result),
    })
    flushSchedulerTicks(1)

    expect(captured.firstSignal?.aborted).toBe(true)
    first.resolve('first')
    await flushMicrotasks()
    expect(applied).toEqual([])

    second.resolve('second')
    await flushMicrotasks()
    expect(applied).toEqual(['second'])
  })

  it('aborts over-budget async work and suppresses the eventual result', async () => {
    vi.useFakeTimers()
    const deferred = createDeferred<string>()
    const applied: string[] = []
    const events: EditorWorkEvent[] = []
    let cancelled = false
    const captured: { signal: AbortSignal | null } = { signal: null }
    const scheduler = new EditorWorkScheduler({ onEvent: (event) => events.push(event) })

    scheduler.schedule({
      key: 'editor.syntax.warmRange',
      taskClass: 'idle-cache',
      budgetMs: 20,
      run: (context) => {
        captured.signal = context.signal
        return deferred.promise
      },
      apply: (result) => applied.push(result),
      cancel: () => {
        cancelled = true
      },
    })

    flushSchedulerTicks(1)
    vi.advanceTimersByTime(20)
    expect(captured.signal?.aborted).toBe(true)
    expect(cancelled).toBe(true)
    expect(events.at(-1)).toMatchObject({ type: 'timed-out', reason: 'budget-timeout' })

    deferred.resolve('late')
    await flushMicrotasks()
    expect(applied).toEqual([])
  })

  it('starts queued work by priority', () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const scheduler = new EditorWorkScheduler()

    scheduler.schedule({
      key: 'idle',
      taskClass: 'idle-cache',
      defer: true,
      run: () => calls.push('idle'),
    })
    scheduler.schedule({
      key: 'visible',
      taskClass: 'visible-render',
      defer: true,
      run: () => calls.push('visible'),
    })
    scheduler.schedule({
      key: 'background',
      taskClass: 'background-derived',
      defer: true,
      run: () => calls.push('background'),
    })

    expect(calls).toEqual([])
    flushSchedulerTicks()
    expect(calls).toEqual(['visible', 'background', 'idle'])
  })

  it('starves delayed work that is rescheduled faster than its delay', () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const scheduler = new EditorWorkScheduler()

    // A typist sustaining 40ms between keystrokes against a 150ms debounce.
    for (let keystroke = 0; keystroke < 20; keystroke += 1) {
      scheduler.schedule({
        key: 'editor.syntax.refresh',
        taskClass: 'viewport-derived',
        delayMs: 150,
        run: () => calls.push('refresh'),
      })
      vi.advanceTimersByTime(40)
    }

    expect(calls).toEqual([])
    scheduler.dispose()
  })

  it('runs rescheduled work once maxDelayMs elapses', () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const scheduler = new EditorWorkScheduler()

    for (let keystroke = 0; keystroke < 20; keystroke += 1) {
      scheduler.schedule({
        key: 'editor.syntax.refresh',
        taskClass: 'viewport-derived',
        delayMs: 150,
        maxDelayMs: 400,
        run: () => calls.push('refresh'),
      })
      vi.advanceTimersByTime(40)
    }

    // 800ms of continuous typing must have produced refreshes rather than none.
    expect(calls.length).toBeGreaterThan(0)
    scheduler.dispose()
  })

  it('does not delay work beyond its own delayMs when maxDelayMs is generous', () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const scheduler = new EditorWorkScheduler()

    scheduler.schedule({
      key: 'editor.syntax.refresh',
      taskClass: 'viewport-derived',
      delayMs: 50,
      maxDelayMs: 5_000,
      run: () => calls.push('refresh'),
    })

    vi.advanceTimersByTime(49)
    expect(calls).toEqual([])
    vi.advanceTimersByTime(1)
    expect(calls).toEqual(['refresh'])
    scheduler.dispose()
  })

  it('restarts the maximum wait after the work actually runs', () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const scheduler = new EditorWorkScheduler()

    const schedule = () =>
      scheduler.schedule({
        key: 'editor.syntax.refresh',
        taskClass: 'viewport-derived',
        delayMs: 50,
        maxDelayMs: 200,
        run: () => calls.push('refresh'),
      })

    schedule()
    vi.advanceTimersByTime(50)
    expect(calls).toEqual(['refresh'])

    // A fresh burst gets the full debounce again, not a deadline inherited
    // from the run that already completed.
    schedule()
    vi.advanceTimersByTime(49)
    expect(calls).toEqual(['refresh'])
    vi.advanceTimersByTime(1)
    expect(calls).toEqual(['refresh', 'refresh'])
    scheduler.dispose()
  })
})
