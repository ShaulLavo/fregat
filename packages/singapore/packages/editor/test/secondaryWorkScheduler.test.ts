import { afterEach, describe, expect, it, vi } from 'vitest'

import { EditorSecondaryWorkScheduler } from '../src/editor/secondaryWorkScheduler'

function flushSchedulerTicks(count = 4): void {
  for (let index = 0; index < count; index += 1) vi.runOnlyPendingTimers()
}

describe('EditorSecondaryWorkScheduler', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs only the latest work scheduled for a key', () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const scheduler = new EditorSecondaryWorkScheduler()

    scheduler.schedule({ key: 'syntax', delayMs: 50, run: () => calls.push('first') })
    vi.advanceTimersByTime(25)
    scheduler.schedule({ key: 'syntax', delayMs: 50, run: () => calls.push('second') })

    vi.advanceTimersByTime(49)
    expect(calls).toEqual([])

    vi.advanceTimersByTime(1)
    flushSchedulerTicks()
    expect(calls).toEqual(['second'])
  })

  it('runs rescheduled work once maxDelayMs elapses', () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const scheduler = new EditorSecondaryWorkScheduler()

    // A fast typist never leaves the 150ms debounce gap, so without a ceiling
    // on the wait the syntax refresh would never run during the burst. 800ms of
    // typing against a 400ms ceiling is exactly two runs — fewer means the
    // ceiling was pushed out, more means it was not honoured as declared.
    for (let keystroke = 0; keystroke < 20; keystroke += 1) {
      scheduler.schedule({
        key: 'editor.syntaxRefresh',
        delayMs: 150,
        maxDelayMs: 400,
        run: () => calls.push('refresh'),
      })
      vi.advanceTimersByTime(40)
    }

    expect(calls).toEqual(['refresh', 'refresh'])
    scheduler.dispose()
  })

  it('keeps debouncing a key that has no maximum wait', () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const scheduler = new EditorSecondaryWorkScheduler()

    for (let keystroke = 0; keystroke < 20; keystroke += 1) {
      scheduler.schedule({ key: 'editor.syntaxRefresh', delayMs: 150, run: () => calls.push('r') })
      vi.advanceTimersByTime(40)
    }

    expect(calls).toEqual([])
    scheduler.dispose()
  })

  it('skips work when the version guard is stale', () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const scheduler = new EditorSecondaryWorkScheduler()

    scheduler.schedule({
      key: 'features',
      delayMs: 25,
      version: 1,
      isCurrent: (version) => version === 2,
      run: () => calls.push('stale'),
    })

    vi.advanceTimersByTime(25)
    flushSchedulerTicks()
    expect(calls).toEqual([])
  })

  it('clears pending timers on dispose', () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const scheduler = new EditorSecondaryWorkScheduler()

    scheduler.schedule({ key: 'features', delayMs: 25, run: () => calls.push('run') })
    scheduler.dispose()
    vi.advanceTimersByTime(25)

    expect(calls).toEqual([])
  })

  it('uses a zero-delay timer fallback instead of running synchronously', () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const scheduler = new EditorSecondaryWorkScheduler()

    scheduler.schedule({ key: 'features', run: () => calls.push('run') })
    expect(calls).toEqual([])

    flushSchedulerTicks()
    expect(calls).toEqual(['run'])
  })
})
