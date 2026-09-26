import type { MachineEvent } from '@workspace/contracts'
import { expect, test } from 'vitest'
import { MachineEvents } from '../events'

test('delivers the initial replay, then each published event in order across wakes', async () => {
  const events = new MachineEvents()
  const controller = new AbortController()
  const stream = events.subscribe('tab-one', [state('idle')], controller.signal)

  expect(await stream.next()).toEqual({ done: false, value: state('idle') })
  for (const phase of ['launching', 'connecting'] as const) {
    const parked = stream.next()
    events.publish(state(phase))
    expect(await parked).toEqual({ done: false, value: state(phase) })
  }

  events.publish(state('idle'), 'tab-two')
  events.publish(state('launching'))
  events.publish(state('connecting'))
  expect(await stream.next()).toEqual({ done: false, value: state('launching') })
  expect(await stream.next()).toEqual({ done: false, value: state('connecting') })

  controller.abort()
  expect(await stream.next()).toEqual({ done: true, value: undefined })
  expect(events.hasClient('tab-one')).toBe(false)
})

test('a parked subscriber is released when its signal aborts', async () => {
  const events = new MachineEvents()
  const controller = new AbortController()
  const stream = events.subscribe('tab-one', [], controller.signal)
  const parked = stream.next()

  controller.abort()

  expect(await parked).toEqual({ done: true, value: undefined })
})

test('a parked subscriber is released when the hub closes', async () => {
  const events = new MachineEvents()
  const stream = events.subscribe('tab-one', [], new AbortController().signal)
  const parked = stream.next()

  events.close()

  expect(await parked).toEqual({ done: true, value: undefined })
})

function state(phase: 'idle' | 'launching' | 'connecting'): MachineEvent {
  return { kind: 'state', state: { name: 'fixture', phase } }
}
