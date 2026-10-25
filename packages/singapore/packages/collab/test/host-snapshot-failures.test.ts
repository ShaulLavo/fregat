import { afterEach, expect, test, vi } from 'vitest'
import { Host } from '../src/index'
import { createEngine } from './engine-fixture'
import { replica } from './fixtures'
import { submitAsAuthor } from './host-fixtures'

afterEach(() => vi.restoreAllMocks())

test.each([undefined, null, false, 0, '', new TypeError('snapshot unavailable')])(
  'host retains the first edit when snapshot throws %j',
  (failure) => {
    const author = replica('author')
    const first = author.insert(0, 'a')
    const engine = createEngine()
    const snapshot = engine.snapshot.bind(engine)
    const host = new Host({ document: 'test', epoch: '1', engine })
    const received: number[] = []
    host.subscribe((message) => received.push(message.sequence))
    vi.spyOn(engine, 'snapshot').mockImplementationOnce(() => {
      throw failure
    })
    let caught: unknown = Symbol('no failure')
    try {
      submitAsAuthor(host, first)
    } catch (error) {
      caught = error
    }
    expect(caught).toBe(failure)
    expect(host.hostSequence).toBe(0)
    expect(host.outcome(first.id)).toBeUndefined()
    expect(host.text()).toBe('')
    expect(received).toEqual([])

    vi.spyOn(engine, 'snapshot').mockImplementation(snapshot)
    const second = author.insert(1, 'b')
    expect(submitAsAuthor(host, second).status).toBe('accepted')
    expect(host.outcome(first.id)).toMatchObject({ status: 'accepted', sequence: 1 })
    expect(host.text()).toBe('ab')
    expect(received).toEqual([1, 2])
  },
)

test('host drains committed broadcasts and retains reentrant edits for an accepted retry', () => {
  const author = replica('author')
  const first = author.insert(0, 'a')
  const second = author.insert(1, 'b')
  const third = author.insert(2, 'c')
  const fourth = author.insert(3, 'd')
  const engine = createEngine()
  const snapshot = engine.snapshot.bind(engine)
  const failure = new TypeError('snapshot unavailable')
  let attempts = 0
  let unavailable = true
  vi.spyOn(engine, 'snapshot').mockImplementation(() => {
    attempts++
    if (attempts >= 3 && unavailable) throw failure
    return snapshot()
  })
  const host = new Host({ document: 'test', epoch: '1', engine })
  host.subscribe((message) => {
    if (message.sequence !== 1) return
    for (const edit of [second, third, fourth])
      expect(submitAsAuthor(host, edit).status).toBe('deferred')
  })
  const reader = replica('reader')
  const received: number[] = []
  host.subscribe((message) => {
    reader.participant.receive([message])
    received.push(message.sequence)
  })

  expect(() => submitAsAuthor(host, first)).toThrow(failure)
  expect(received).toEqual([1, 2])
  expect(host.hostSequence).toBe(2)
  expect(host.text()).toBe('ab')
  expect(host.outcome(second.id)).toMatchObject({ status: 'accepted', sequence: 2 })
  expect(host.outcome(third.id)).toBeUndefined()
  expect(host.outcome(fourth.id)).toBeUndefined()
  expect(attempts).toBe(3)
  expect(() => submitAsAuthor(host, second)).toThrow(failure)
  expect(attempts).toBe(4)
  expect(received).toEqual([1, 2])

  unavailable = false
  expect(submitAsAuthor(host, second)).toBe(host.outcome(second.id))
  expect(attempts).toBe(6)
  expect(received).toEqual([1, 2, 3, 4])
  expect(host.text()).toBe('abcd')
  expect(reader.participant.state()).toMatchObject({
    text: 'abcd',
    hostSequence: 4,
    pending: [],
    blocked: [],
  })
  for (const edit of [first, second, third, fourth])
    expect(submitAsAuthor(host, edit)).toBe(host.outcome(edit.id))
  expect(received).toEqual([1, 2, 3, 4])
})

test.each([1, 2])(
  'host preserves the callback error from sequence %i alongside snapshot failure',
  (failedSequence) => {
    const author = replica('author')
    const first = author.insert(0, 'a')
    const second = author.insert(1, 'b')
    const third = author.insert(2, 'c')
    const engine = createEngine()
    const snapshot = engine.snapshot.bind(engine)
    const snapshotFailure = new TypeError('snapshot unavailable')
    let attempts = 0
    vi.spyOn(engine, 'snapshot').mockImplementation(() => {
      if (++attempts === 3) throw snapshotFailure
      return snapshot()
    })
    const host = new Host({ document: 'test', epoch: '1', engine })
    const callbackFailure = new TypeError('receiver failure')
    const laterFailure = new TypeError('later receiver failure')
    const stop = host.subscribe((message) => {
      if (message.sequence === 1) {
        submitAsAuthor(host, second)
        submitAsAuthor(host, third)
      }
      if (message.sequence === failedSequence) throw callbackFailure
    })
    const stopLater = host.subscribe((message) => {
      if (message.sequence === failedSequence) throw laterFailure
    })
    const received: number[] = []
    host.subscribe((message) => received.push(message.sequence))
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => submitAsAuthor(host, first)).toThrow(callbackFailure)
    expect(received).toEqual([1, 2])
    expect(report).toHaveBeenCalledExactlyOnceWith('[collab]', 'collab.observers.failed', {
      level: 'error',
      operation: 'host.broadcast',
      internal: { failureCount: 2 },
    })
    stop()
    stopLater()
    expect(submitAsAuthor(host, second).status).toBe('accepted')
    expect(host.text()).toBe('abc')
    expect(received).toEqual([1, 2, 3])
  },
)
