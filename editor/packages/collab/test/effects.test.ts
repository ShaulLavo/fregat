import { submitAsAuthor } from './host-fixtures'
import { expect, test } from 'vitest'
import type { Envelope } from '../src/index'
import { authority, replica } from './fixtures'

function effect(source: Envelope, seq: number, active: boolean): Envelope {
  const id = { actor: source.id.actor, seq }
  return {
    ...source,
    id,
    lamport: source.lamport + seq,
    deps: [source.id],
    change: {
      kind: 'setEffects',
      command: id,
      effects: [{ op: source.id, active }],
    },
  }
}

test('two overlapping deletions keep both provenances even when the second arrives hidden', () => {
  const a = replica('a'),
    b = replica('b')
  const { host, messages } = authority()
  const insert = a.insert(0, 'abc')
  submitAsAuthor(host, insert)
  a.participant.receive(messages)
  b.participant.receive(messages)
  const left = a.remove(1, 1),
    right = b.remove(1, 1)
  submitAsAuthor(host, left)
  submitAsAuthor(host, right)
  expect(host.text()).toBe('ac')
  submitAsAuthor(host, effect(left, 3, false))
  expect(host.text()).toBe('ac')
  submitAsAuthor(host, effect(right, 2, false))
  expect(host.text()).toBe('abc')
  submitAsAuthor(host, effect(left, 4, true))
  expect(host.text()).toBe('ac')
})

test('undo an insertion containing remote text and redo through a remote delete', () => {
  const a = replica('a'),
    b = replica('b')
  const { host, messages } = authority()
  const insert = a.insert(0, 'abc')
  submitAsAuthor(host, insert)
  b.participant.receive(messages)
  submitAsAuthor(host, b.insert(1, 'X'))
  submitAsAuthor(host, effect(insert, 2, false))
  expect(host.text()).toBe('X')
  submitAsAuthor(host, effect(insert, 3, true))
  expect(host.text()).toBe('aXbc')
  b.participant.receive(messages)
  submitAsAuthor(host, b.remove(0, 1))
  submitAsAuthor(host, effect(insert, 4, false))
  submitAsAuthor(host, effect(insert, 5, true))
  expect(host.text()).toBe('Xbc')
})
