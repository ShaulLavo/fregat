import { expect, test } from 'vitest'
import type { TraceEvent } from '../agent/trace-types'
import { typingCost } from './typing-cost'

function event(name: string, ts: number, dur = 0, ph = 'X', args = {}): TraceEvent {
  return { name, ts, dur, ph, args, pid: 1, tid: 2, cat: '', id: '' }
}

test('counts input and frame work without idle time or double-counting tasks', () => {
  const events = [
    event('thread_name', 0, 0, 'M', { name: 'CrRendererMain' }),
    event('RunTask', 0, 3000),
    event('EventDispatch', 100, 2000),
    event('large-file-key:start:0', 200, 0, 'I'),
    event('RunTask', 10000, 1000),
    event('RunTask', 10000, 1000),
    event('large-file-key:end:0', 10500, 0, 'I'),
    { ...event('RunTask', 0, 20000), tid: 3 },
  ]
  const result = typingCost(events, 1)
  expect(result.p50).toBe(4)
  expect(result.p95).toBe(4)
  expect(result.samples[0]).toMatchObject({ mainThreadMs: 4, eventDispatchMs: 2, windowMs: 11 })
})

test('refuses a missing key rather than reporting fewer samples', () => {
  expect(() => typingCost([event('RunTask', 0, 1000)], 1)).toThrow('Every key')
})

test('refuses markers without surrounding main-thread tasks', () => {
  expect(() =>
    typingCost(
      [
        event('thread_name', 0, 0, 'M', { name: 'CrRendererMain' }),
        event('large-file-key:start:0', 100),
        event('large-file-key:end:0', 200),
      ],
      1,
    ),
  ).toThrow('enclosed')
})
