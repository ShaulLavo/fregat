import { sessionIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { SessionScheduleRegistry } from '../session-schedules'
import { nextCronFire } from '../utils/cron-next'

// Local time throughout: the harness fires crons by the machine's clock.
const at = (text: string) => new Date(text)

describe('next cron fire', () => {
  it('finds the next minute, hour, weekday and day-of-month match', () => {
    expect(nextCronFire('*/15 * * * *', at('2026-09-26T10:07:30'))).toEqual(at('2026-09-26T10:15'))
    expect(nextCronFire('0 9 * * 1-5', at('2026-09-26T10:00'))).toEqual(at('2026-09-28T09:00'))
    expect(nextCronFire('30 14 1 * *', at('2026-09-26T10:00'))).toEqual(at('2026-10-01T14:30'))
  })

  it('reads a one-shot wake-up as its single fire time, and never again after it', () => {
    expect(nextCronFire('37 14 26 9 *', at('2026-09-26T14:00'))).toEqual(at('2026-09-26T14:37'))
    expect(nextCronFire('37 14 30 2 *', at('2026-09-26T14:00'))).toBeNull()
  })

  it('treats both restricted day fields as either-or, and 7 as Sunday', () => {
    // The 1st is a Thursday in October 2026; Sunday the 27th of September comes first.
    expect(nextCronFire('0 0 1 * 7', at('2026-09-26T12:00'))).toEqual(at('2026-09-27T00:00'))
  })

  it('refuses expressions it cannot read', () => {
    expect(nextCronFire('every morning', at('2026-09-26T12:00'))).toBeNull()
    expect(nextCronFire('61 * * * *', at('2026-09-26T12:00'))).toBeNull()
    expect(nextCronFire('@daily', at('2026-09-26T12:00'))).toBeNull()
  })
})

describe('session schedules', () => {
  const wakeup = { id: 'w', schedule: '37 14 26 9 *', recurring: false, prompt: 'check the build' }
  const hourly = { id: 'h', schedule: '0 * * * *', recurring: true, prompt: 'poll' }

  it('reports the earliest fire, and forgets everything when the report is empty', () => {
    const registry = new SessionScheduleRegistry()
    registry.record('s', [hourly, wakeup], at('2026-09-26T14:00'))

    expect(registry.sleepingUntil('s', at('2026-09-26T14:10'))).toBe(
      at('2026-09-26T14:37').toISOString(),
    )
    expect(registry.list('s', at('2026-09-26T14:40')).map((item) => item.nextFireAt)).toEqual([
      at('2026-09-26T15:00').toISOString(),
      at('2026-09-26T14:37').toISOString(),
    ])
    registry.record('s', [], at('2026-09-26T14:41'))
    expect(registry.has('s')).toBe(false)
    expect(registry.sleepingUntil('s')).toBeNull()
  })

  it('keeps a held one-shot due at its time when a later report still lists it', () => {
    const registry = new SessionScheduleRegistry()
    registry.record('s', [wakeup], at('2026-09-26T14:00'))
    registry.record('s', [wakeup], at('2026-09-26T15:00'))

    expect(registry.sleepingUntil('s', at('2026-09-26T15:00'))).toBe(
      at('2026-09-26T14:37').toISOString(),
    )
  })

  it('reads a one-shot first reported after its minute as due, not next year', () => {
    const registry = new SessionScheduleRegistry()
    registry.record('s', [wakeup], at('2026-09-26T14:39'))
    expect(registry.sleepingUntil('s', at('2026-09-26T14:40'))).toBe(
      at('2026-09-26T14:37').toISOString(),
    )
    registry.record('late', [wakeup], at('2026-09-26T14:37:20'))
    expect(registry.sleepingUntil('late')).toBe(at('2026-09-26T14:37').toISOString())
  })

  it('drops a session’s schedules when its runtime exits', () => {
    const registry = new SessionScheduleRegistry()
    const sessionId = v.parse(sessionIdSchema, '5d0c3a4e-8f1b-4c2d-9e7a-6b5c4d3e2f10')
    registry.record(sessionId, [wakeup], at('2026-09-26T14:00'))
    registry.accept({
      createdAt: '2026-09-26T14:05:00.000Z',
      eventId: 'exit',
      payload: { reason: 'stopped' },
      runtimeEpoch: 'epoch',
      sessionId,
      type: 'runtime.exited',
    })

    expect(registry.count()).toBe(0)
  })
})
