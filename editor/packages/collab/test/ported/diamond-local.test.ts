import { submitAsAuthor } from '../host-fixtures'
// josephg/diamond-types @ 89ae3a0ab8d941a2885e6ec89d094bc9ce9d2922.
// src/listmerge/fuzzer.rs, random_single_document (seed 10, rope oracle).
// src/listmerge/merge.rs, ins_back, backspace and test_concurrent_delete.
// Adapted to Singapore ID-space edits. ISC, Seph Gentle and Diamond Types
// contributors. See ../../THIRD_PARTY_TEST_NOTICES.md. The RNG is adapted;
// seed numbers do not reproduce Rust SmallRng's exact operation stream.
import { expect, test } from 'vitest'
import { replica } from '../fixtures'
import { characters } from '../engine-fixture'
import { network, randomSource } from './adapter'
import { randomChange } from './diamond-workload'

const stress = process.env.COLLAB_STRESS === '1'
const seeds = [10].concat(
  Array.from({ length: stress ? 100 : 16 }, (_, index) => index).filter((seed) => seed !== 10),
)

test.each(seeds)(
  'Diamond Types local rope-oracle workload, seed %i',
  (seed) => {
    const author = replica('seph')
    const random = randomSource(seed)
    let oracle = ''
    const steps = stress ? 1000 : 100
    for (let step = 0; step < steps; step++) {
      const change = randomChange(oracle, random)
      for (const edit of change.edits) author.participant.local(edit)
      oracle = change.text
      expect(author.engine.text(), `seed ${seed}, step ${step}`).toBe(oracle)
    }
    const snapshot = author.engine.snapshot()
    author.engine.restore(snapshot)
    expect(author.engine.text()).toBe(oracle)
  },
  30_000,
)

test('Diamond Types backward insertion preserves abc', () => {
  const net = network(2)
  for (const text of ['c', 'b', 'a']) net.edit(0, { offset: 0, deleteCount: 0, text })
  expect(net.users[0]!.participant.text()).toBe('abc')
  expect(net.settle()).toBe('abc')
})

test('Diamond Types backspace removes abc from right to left', () => {
  const net = network(2)
  net.edit(0, { offset: 0, deleteCount: 0, text: 'abc' })
  for (const offset of [2, 1, 0]) {
    net.edit(0, { offset, deleteCount: 1, text: '' })
    expect(net.users[0]!.participant.text()).toBe('abc'.slice(0, offset))
  }
  expect(net.settle()).toBe('')
})

test('Diamond Types repeated concurrent deletion preserves one hidden ID per character', () => {
  const net = network(2)
  net.edit(0, { offset: 0, deleteCount: 0, text: 'aaa' })
  net.flushAll()
  const a = net.edit(0, { offset: 1, deleteCount: 1, text: '' })
  const b = net.edit(1, { offset: 0, deleteCount: 3, text: '' })
  expect(net.settle()).toBe('')
  const snapshot = net.engine.snapshot()
  for (let repeat = 0; repeat < 10; repeat++) {
    submitAsAuthor(net.host, a)
    submitAsAuthor(net.host, b)
    net.engine.apply(a)
    net.engine.apply(b)
  }
  expect(net.host.hostSequence).toBe(3)
  expect(net.engine.snapshot()).toEqual(snapshot)
  expect(characters(net.engine)).toHaveLength(3)
  expect(characters(net.engine).every((node) => node.deleted)).toBe(true)
})
