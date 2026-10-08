import { expect, test } from 'vitest'
import { Host } from '../src/index'
import { createEngine } from './engine-fixture'
import { replica } from './fixtures'
import { submitAsAuthor } from './host-fixtures'

test.each([
  { deferred: false, nested: false },
  { deferred: true, nested: false },
  { deferred: false, nested: true },
  { deferred: true, nested: true },
])('host finishes delivery before surfacing failures with %j', ({ deferred, nested }) => {
  const author = replica('author')
  const first = author.insert(0, 'a')
  const second = author.insert(1, 'b')
  const third = author.insert(2, 'c')
  const host = new Host({ document: 'test', epoch: '1', engine: createEngine() })
  const failure = new TypeError('first receiver failure')
  const laterFailure = new TypeError('later receiver failure')
  const failingSequences: number[] = []
  const stop = host.subscribe((message) => {
    failingSequences.push(message.sequence)
    if (nested && message.sequence === 1)
      expect(submitAsAuthor(host, deferred ? third : second).status).toBe('deferred')
    throw message.sequence === 1 ? failure : laterFailure
  })
  const healthy = [author, replica('reader')]
  const sequences: number[][] = [[], []]
  for (const [index, { participant }] of healthy.entries()) {
    host.subscribe((message) => {
      participant.receive([message])
      sequences[index]!.push(message.sequence)
    })
  }
  const stopLater = host.subscribe(() => {
    throw laterFailure
  })

  if (deferred) expect(submitAsAuthor(host, second).status).toBe('deferred')
  let caught: unknown
  try {
    submitAsAuthor(host, first)
  } catch (error) {
    caught = error
  }
  expect(caught).toBe(failure)
  const expected = [1]
  if (deferred || nested) expected.push(2)
  if (deferred && nested) expected.push(3)
  expect(failingSequences).toEqual(expected)
  expect(sequences).toEqual([expected, expected])
  expect(host.hostSequence).toBe(expected.length)
  expect(host.text()).toBe('abc'.slice(0, expected.length))
  expect(author.participant.state()).toMatchObject({ text: 'abc', hostSequence: expected.length })
  expect(healthy[1]!.participant.state()).toMatchObject({
    text: host.text(),
    hostSequence: expected.length,
    pending: [],
    blocked: [],
  })
  for (const envelope of [first, second, third].slice(0, expected.length))
    expect(host.outcome(envelope.id)).toMatchObject({ status: 'accepted', envelope })

  stop()
  stopLater()
  expect(submitAsAuthor(host, first)).toBe(host.outcome(first.id))
  expect(sequences).toEqual([expected, expected])
  for (const envelope of [second, third])
    expect(submitAsAuthor(host, envelope).status).toBe('accepted')
  expect(submitAsAuthor(host, author.insert(3, 'd')).status).toBe('accepted')
  expect(host.text()).toBe('abcd')
  expect(host.hostSequence).toBe(4)
  expect(sequences).toEqual([
    [1, 2, 3, 4],
    [1, 2, 3, 4],
  ])
  for (const { participant } of healthy)
    expect(participant.state()).toMatchObject({
      text: 'abcd',
      hostSequence: 4,
      pending: [],
      blocked: [],
    })
})
