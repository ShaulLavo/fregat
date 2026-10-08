import { strictEqual, ok } from 'node:assert/strict'
import { mainThread, type TraceEvent } from '../agent/trace-types'

export function typingCost(events: readonly TraceEvent[], keys: number) {
  const thread = mainThread(events)
  const own = events.filter((event) => event.pid === thread.pid && event.tid === thread.tid)
  const tasks = own.filter((event) => event.name === 'RunTask' && event.ph === 'X' && event.dur > 0)
  const samples = []
  for (let index = 0; index < keys; index++) {
    const start = own.find((event) => event.name === `large-file-key:start:${index}`)
    const end = own.find((event) => event.name === `large-file-key:end:${index}`)
    ok(start && end && end.ts > start.ts, 'Every key must have an ordered trace window')
    const first = tasks.find((event) => event.ts <= start.ts && event.ts + event.dur >= start.ts)
    const last = tasks.find((event) => event.ts <= end.ts && event.ts + event.dur >= end.ts)
    ok(first && last, 'Trace windows must be enclosed by main-thread tasks')
    const begin = first.ts
    const finish = last.ts + last.dur
    const windows = tasks.filter((event) => event.ts < finish && event.ts + event.dur > begin)
    // RunTask is top-level; merge intervals so nested or duplicate events cannot double count.
    const intervals = windows
      .map((event) => [Math.max(begin, event.ts), Math.min(finish, event.ts + event.dur)] as const)
      .sort((a, b) => a[0] - b[0])
    let total = 0
    let cursor = begin
    for (const [left, right] of intervals) {
      total += Math.max(0, right - Math.max(cursor, left))
      cursor = Math.max(cursor, right)
    }
    const dispatches = own.filter(
      (event) =>
        event.name === 'EventDispatch' &&
        event.ph === 'X' &&
        event.ts >= begin &&
        event.ts + event.dur <= finish,
    )
    samples.push({
      key: index,
      mainThreadMs: total / 1000,
      eventDispatchMs: dispatches.reduce((sum, event) => sum + event.dur, 0) / 1000,
      windowMs: (finish - begin) / 1000,
    })
  }
  strictEqual(samples.length, keys)
  const sorted = samples.map((item) => item.mainThreadMs).sort((a, b) => a - b)
  return {
    method:
      'Sum of renderer main-thread RunTask intervals from the keydown task through the second animation-frame callback task. Includes input processing, frame work and other main-thread work in that window; excludes idle time and worker time. This is an upper bound on causal keystroke work.',
    count: keys,
    p50: sorted[Math.floor(keys * 0.5)],
    p95: sorted[Math.min(keys - 1, Math.ceil(keys * 0.95) - 1)],
    max: sorted.at(-1),
    samples,
  }
}
