// yjs/yjs @ d01eefc997cf12d29d5aabea804df5f69c659a79.
// tests/y-text.tests.js, testBasicInsertAndDelete.
// tests/y-array.tests.js, testInsertThreeElementsTryRegetProperty,
// testConcurrentInsertWithThreeConflicts, testConcurrentInsertDeleteWithThreeConflicts,
// testInsertionsInLateSync, testDisconnectReallyPreventsSendingMessages,
// testDeletionsInLateSync, testInsertThenMergeDeleteOnSync.
// Adapted to Singapore ID-space edits, arrays represented as character sequences.
// MIT, Copyright (c) 2023 Kevin Jahns and RWTH Aachen University, Germany,
// Chair of Computer Science 5. See ../../THIRD_PARTY_TEST_NOTICES.md.
import { expect, test } from 'vitest'
import { network } from './adapter'

test('Yjs basic text insertion and deletion', () => {
  const net = network(2)
  net.edit(0, { offset: 0, deleteCount: 0, text: 'abc' })
  expect(net.users[0]!.participant.text()).toBe('abc')
  net.edit(0, { offset: 0, deleteCount: 1, text: '' })
  expect(net.users[0]!.participant.text()).toBe('bc')
  net.edit(0, { offset: 1, deleteCount: 1, text: '' })
  expect(net.users[0]!.participant.text()).toBe('b')
  net.edit(0, { offset: 0, deleteCount: 0, text: '1' })
  net.edit(0, { offset: 0, deleteCount: 1, text: '' })
  expect(net.settle()).toBe('b')
})

test('Yjs insert three array elements and read the remote sequence', () => {
  const net = network(2)
  net.edit(0, { offset: 0, deleteCount: 0, text: '1TF' })
  expect(net.users[0]!.participant.text()).toBe('1TF')
  net.flushAll()
  expect(net.users[1]!.participant.text()).toBe('1TF')
  expect(net.settle()).toBe('1TF')
})

test('Yjs three concurrent array insertions preserve each value', () => {
  const net = network(3)
  for (let user = 0; user < 3; user++)
    net.edit(user, { offset: 0, deleteCount: 0, text: String(user) })
  expect([...net.settle()].sort().join('')).toBe('012')
})

test('Yjs concurrent array insertion and deletion target the original IDs', () => {
  const net = network(3)
  net.edit(0, { offset: 0, deleteCount: 0, text: 'xyz' })
  net.flushAll()
  net.edit(0, { offset: 1, deleteCount: 0, text: '0' })
  net.edit(1, { offset: 0, deleteCount: 1, text: '' })
  expect(net.users[1]!.participant.text()).toBe('yz')
  net.edit(1, { offset: 1, deleteCount: 1, text: '' })
  net.edit(2, { offset: 1, deleteCount: 0, text: '2' })
  const result = net.settle()
  expect([...result].sort().join('')).toBe('02y')
})

test('Yjs insertions in late sync preserve all three authored runs', () => {
  const net = network(3)
  net.edit(0, { offset: 0, deleteCount: 0, text: 'xy' })
  net.flushAll()
  net.disconnect(1)
  net.disconnect(2)
  for (let user = 0; user < 3; user++)
    net.edit(user, { offset: 1, deleteCount: 0, text: `user${user}` })
  net.connect(1)
  net.connect(2)
  const result = net.settle()
  expect(result.startsWith('x')).toBe(true)
  expect(result.endsWith('y')).toBe(true)
  for (let user = 0; user < 3; user++) expect(result).toContain(`user${user}`)
  expect(result).toHaveLength(17)
})

test('Yjs disconnect prevents sending and receiving until reconnect', () => {
  const net = network(3)
  net.edit(0, { offset: 0, deleteCount: 0, text: 'xy' })
  net.flushAll()
  net.disconnect(1)
  net.disconnect(2)
  net.edit(0, { offset: 1, deleteCount: 0, text: 'user0' })
  net.edit(1, { offset: 1, deleteCount: 0, text: 'user1' })
  net.flushAll()
  expect(net.host.text()).toBe('xuser0y')
  expect(net.users[0]!.participant.text()).toBe('xuser0y')
  expect(net.users[1]!.participant.text()).toBe('xuser1y')
  expect(net.users[2]!.participant.text()).toBe('xy')
  expect(net.users[1]!.participant.state().pending).toHaveLength(1)
  net.settle()
})

test('Yjs overlapping deletions in late sync delete each original ID once', () => {
  const net = network(2)
  net.edit(0, { offset: 0, deleteCount: 0, text: 'xy' })
  net.flushAll()
  net.disconnect(1)
  net.edit(1, { offset: 1, deleteCount: 1, text: '' })
  net.edit(0, { offset: 0, deleteCount: 2, text: '' })
  expect(net.users[1]!.participant.text()).toBe('x')
  expect(net.settle()).toBe('')
})

test('Yjs offline author receives a remote delete on reconnect', () => {
  const net = network(2)
  net.edit(0, { offset: 0, deleteCount: 0, text: 'xyz' })
  net.flushAll()
  net.disconnect(0)
  net.edit(1, { offset: 0, deleteCount: 3, text: '' })
  net.flushAll()
  expect(net.users[0]!.participant.text()).toBe('xyz')
  expect(net.settle()).toBe('')
})
