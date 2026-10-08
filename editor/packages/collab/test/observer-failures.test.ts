import { afterEach, expect, test, vi } from 'vitest'
import { Host } from '../src/index'
import { createEngine } from './engine-fixture'
import { replica } from './fixtures'
import { submitAsAuthor } from './host-fixtures'

afterEach(() => vi.restoreAllMocks())

test('host snapshots receivers across throwing reconnects and reentrant edits', () => {
  const author = replica('author')
  const first = author.insert(0, 'a')
  const second = author.insert(1, 'b')
  const host = new Host({ document: 'test', epoch: '1', engine: createEngine() })
  const failure = new TypeError('receiver disconnected')
  const received: number[] = []
  let unsubscribe = () => {}
  const reconnect = (message: import('../src/index').HostMessage) => {
    received.push(message.sequence)
    if (received.length === 1) submitAsAuthor(host, second)
    // Bound reconnects so a live iterator fails without hanging the suite.
    if (received.length < 4) {
      unsubscribe()
      unsubscribe = host.subscribe(reconnect)
    }
    throw failure
  }
  unsubscribe = host.subscribe(reconnect)
  const reader = replica('reader')
  const healthy: number[] = []
  host.subscribe((message) => {
    reader.participant.receive([message])
    healthy.push(message.sequence)
  })
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})

  expect(() => submitAsAuthor(host, first)).toThrow(failure)
  expect(received).toEqual([1, 2])
  expect(healthy).toEqual([1, 2])
  expect(host.text()).toBe('ab')
  expect(host.hostSequence).toBe(2)
  expect(reader.participant.state()).toMatchObject({ text: 'ab', hostSequence: 2 })
  expect(report).toHaveBeenCalledExactlyOnceWith('[collab]', 'collab.observers.failed', {
    level: 'error',
    operation: 'host.broadcast',
    internal: { failureCount: 2 },
  })
  unsubscribe()
  expect(submitAsAuthor(host, author.insert(2, 'c')).status).toBe('accepted')
  expect(healthy).toEqual([1, 2, 3])
})

test('host skips removed registrations and starts replacements on the next broadcast', () => {
  const author = replica('author')
  const first = author.insert(0, 'a')
  const second = author.insert(1, 'b')
  const host = new Host({ document: 'test', epoch: '1', engine: createEngine() })
  const received: number[] = []
  const listener = (message: import('../src/index').HostMessage) => received.push(message.sequence)
  let unsubscribe = () => {}
  host.subscribe((message) => {
    if (message.sequence !== 1) return
    unsubscribe()
    unsubscribe = host.subscribe(listener)
    submitAsAuthor(host, second)
  })
  unsubscribe = host.subscribe(listener)
  submitAsAuthor(host, first)
  expect(received).toEqual([2])
})

test('participant snapshots subscribers across throwing reconnects and reentrant edits', () => {
  const author = replica('author')
  const failure = new TypeError('subscriber disconnected')
  const received: number[] = []
  let unsubscribe = () => {}
  const reconnect = (change: import('../src/index').ParticipantChange) => {
    received.push(change.pending.length)
    unsubscribe()
    unsubscribe = author.participant.subscribe(reconnect)
    if (received.length === 1) author.insert(1, 'b')
    throw failure
  }
  unsubscribe = author.participant.subscribe(reconnect)
  const healthy: number[] = []
  author.participant.subscribe((change) => healthy.push(change.pending.length))
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})

  expect(() => author.insert(0, 'a')).toThrow(failure)
  expect(received).toEqual([1, 2])
  expect(healthy).toEqual([1, 2])
  expect(author.participant.text()).toBe('ab')
  expect(report).toHaveBeenCalledExactlyOnceWith('[collab]', 'collab.observers.failed', {
    level: 'error',
    operation: 'participant.publish',
    internal: { failureCount: 2 },
  })
  unsubscribe()
  author.insert(2, 'c')
  expect(healthy).toEqual([1, 2, 3])
})

for (const source of ['host', 'participant'] as const) {
  test.each([
    { first: undefined },
    { first: null },
    { first: false },
    { first: 0 },
    { first: '' },
    { first: new TypeError('first observer failed') },
  ])(`${source} reports multiple failures once while preserving %j`, ({ first }) => {
    const author = replica('author')
    const host = new Host({ document: 'test', epoch: '1', engine: createEngine() })
    const subscribe = (listener: () => void) =>
      source === 'host' ? host.subscribe(listener) : author.participant.subscribe(listener)
    const laterFailure = new TypeError('second observer failed')
    subscribe(() => {
      throw first
    })
    subscribe(() => {
      throw laterFailure
    })
    let healthy = 0
    subscribe(() => healthy++)
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    let caught: unknown = Symbol('no failure')
    try {
      const envelope = author.insert(0, 'a')
      if (source === 'host') submitAsAuthor(host, envelope)
    } catch (error) {
      caught = error
    }
    expect(caught).toBe(first)
    expect(healthy).toBe(1)
    expect(report).toHaveBeenCalledExactlyOnceWith('[collab]', 'collab.observers.failed', {
      level: 'error',
      operation: source === 'host' ? 'host.broadcast' : 'participant.publish',
      internal: { failureCount: 2 },
    })
  })
}
