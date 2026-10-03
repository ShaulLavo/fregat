import { afterEach, expect, it, vi } from 'vitest'
import { LocalTerminalExecution } from '../execution-local.js'
import type { CustomOscObservation } from '../../core/types.js'

const executions: LocalTerminalExecution[] = []
const decoder = new TextDecoder()

afterEach(() => {
  vi.restoreAllMocks()
  for (const execution of executions.splice(0)) execution.dispose()
})

async function createExecution(): Promise<LocalTerminalExecution> {
  const execution = await LocalTerminalExecution.create({})
  executions.push(execution)
  return execution
}

it('owns synchronous setup and publishes generation-tagged observations before operation return', async () => {
  const execution = await createExecution()
  expect(execution.kind).toBe('sync')
  const order: string[] = []
  const events: CustomOscObservation[] = []
  const subscription = execution.observeCustomOsc(7400, (event) => {
    events.push(event)
    order.push(`osc:${decoder.decode(event.payload)}:${execution.revision}`)
  })
  expect(typeof subscription.dispose).toBe('function')
  const result = execution.write('\x1b]7400;local\x07')
  order.push(`return:${result.revision}`)
  expect(order).toEqual(['osc:local:1', 'return:1'])
  expect(events[0]).toMatchObject({
    number: 7400,
    generation: 1,
    terminator: 'bel',
    truncated: false,
  })
})

it('does not deliver an old native capture to a new same-number owner', async () => {
  const execution = await createExecution()
  const oldEvents: CustomOscObservation[] = []
  const newEvents: CustomOscObservation[] = []
  const old = execution.observeCustomOsc(7400, (event) => oldEvents.push(event))
  const bell = execution.on('bell', () => {
    bell.dispose()
    old.dispose()
    execution.observeCustomOsc(7400, (event) => newEvents.push(event))
    execution.write('\x1b]7400;new\x07')
  })
  execution.write('\x07\x1b]7400;old\x07')
  expect(oldEvents).toHaveLength(0)
  expect(newEvents.map((event) => decoder.decode(event.payload))).toEqual(['new'])
  expect(newEvents[0]!.generation).toBeGreaterThan(1)
  old.dispose()
  execution.write('\x1b]7400;new again\x07')
  expect(newEvents).toHaveLength(2)
})

it('routes only the subscribed number and permits replacement without stale cleanup deleting it', async () => {
  const execution = await createExecution()
  const first: string[] = []
  const second: string[] = []
  const other: string[] = []
  const previous = execution.observeCustomOsc(7400, (event) =>
    first.push(decoder.decode(event.payload)),
  )
  execution.observeCustomOsc(7499, (event) => other.push(decoder.decode(event.payload)))
  execution.observeCustomOsc(7400, (event) => second.push(decoder.decode(event.payload)))
  previous.dispose()
  execution.write('\x1b]7400;second\x07\x1b]7499;other\x07\x1b]7500;uninterested\x07')
  expect(first).toEqual([])
  expect(second).toEqual(['second'])
  expect(other).toEqual(['other'])
})

it('isolates owners across independent executions and removes them on disposal', async () => {
  const first = await createExecution()
  const second = await createExecution()
  const firstEvents: string[] = []
  const secondEvents: string[] = []
  const subscription = first.observeCustomOsc(7400, (event) =>
    firstEvents.push(decoder.decode(event.payload)),
  )
  second.observeCustomOsc(7400, (event) => secondEvents.push(decoder.decode(event.payload)))
  first.write('\x1b]7400;first\x07')
  second.write('\x1b]7400;second\x07')
  expect(firstEvents).toEqual(['first'])
  expect(secondEvents).toEqual(['second'])
  first.write('\x1b]7400;partial')
  first.dispose()
  subscription.dispose()
  first.dispose()
  expect(firstEvents).toEqual(['first'])
  expect(() => first.observeCustomOsc(7400, () => {})).toThrow('disposed')
  second.write('\x1b]7400;alive\x07')
  expect(secondEvents).toEqual(['second', 'alive'])
})

it('allows a local observer to reset and detach after execution without leaking queued captures', async () => {
  const execution = await createExecution()
  const events: string[] = []
  const subscription = execution.observeCustomOsc(7400, (event) => {
    events.push(decoder.decode(event.payload))
    subscription.dispose()
    execution.reset()
  })
  execution.write('\x1b]7400;first\x07\x1b]7400;second\x07')
  expect(events).toEqual(['first'])
  expect(execution.revision).toBe(2)
})

it('does constant-time owner lookup with 1000 active number subscriptions', async () => {
  const execution = await createExecution()
  let deliveries = 0
  for (let number = 10000; number < 11000; number += 1) {
    execution.observeCustomOsc(number, () => {
      deliveries += 1
    })
  }
  const owners = (execution as unknown as { customOscOwners: Map<number, unknown> }).customOscOwners
  const get = vi.spyOn(owners, 'get')
  const values = vi.spyOn(owners, 'values')
  const entries = vi.spyOn(owners, 'entries')
  const iterate = vi.spyOn(owners, Symbol.iterator)
  execution.write('\x1b]11001;unmatched\x07')
  const unmatched = [
    get.mock.calls.length,
    values.mock.calls.length,
    entries.mock.calls.length,
    iterate.mock.calls.length,
  ]
  execution.write('\x1b]10999;matched\x07')
  const matched = [
    get.mock.calls.length,
    values.mock.calls.length,
    entries.mock.calls.length,
    iterate.mock.calls.length,
  ]
  vi.restoreAllMocks()
  expect(unmatched).toEqual([0, 0, 0, 0])
  expect(matched).toEqual([1, 0, 0, 0])
  expect(deliveries).toBe(1)
})
