// yjs/yjs @ d01eefc997cf12d29d5aabea804df5f69c659a79.
// tests/testHelper.js, applyRandomTests; tests/y-array.tests.js,
// arrayTransactions and testRepeatGeneratingYarrayTests6/40/42/43/44/45/46/300/400/500.
// Adapted to Singapore ID-space edits: one host, five optimistic participants,
// flat character arrays, disconnect/reconnect and random packet delivery.
// Nested containers and Yjs codec assertions are omitted. The RNG is adapted.
// MIT, Copyright (c) 2023 Kevin Jahns and RWTH Aachen University, Germany,
// Chair of Computer Science 5. See ../../THIRD_PARTY_TEST_NOTICES.md.
import { expect, test } from 'vitest'
import { network, randomSource } from './adapter'
import { stressSeeds } from '../stress-seeds'

const counts =
  process.env.COLLAB_STRESS === '1'
    ? [6, 40, 42, 43, 44, 45, 46, 300, 400, 500, 600, 1000]
    : [6, 40, 42, 43, 44, 45, 46]

function runScheduler(iterations: number, seed: number) {
  const net = network(5)
  const random = randomSource(seed)
  const integer = (max: number) => Math.floor(random() * (max + 1))
  for (let step = 0; step < iterations; step++) {
    if (integer(100) <= 2) {
      const disconnect = random() < 0.5
      const candidates = net.users.flatMap((_, user) =>
        net.online.has(user) === disconnect ? [user] : [],
      )
      if (candidates.length > 0) {
        const user = candidates[integer(candidates.length - 1)]!
        if (disconnect) net.disconnect(user)
        else net.connect(user)
      }
    } else if (integer(100) <= 1) {
      net.flushAll()
    } else if (integer(100) <= 50) {
      net.flushOne(random)
    }
    const user = integer(4)
    const before = net.users[user]!.participant.text()
    if (before.length === 0 || random() < 0.5) {
      const offset = integer(before.length)
      const text = String.fromCharCode(97 + (step % 26)).repeat(1 + integer(3))
      net.edit(user, { offset, deleteCount: 0, text })
      expect(net.users[user]!.participant.text(), `step ${step}`).toBe(
        before.slice(0, offset) + text + before.slice(offset),
      )
      continue
    }
    const offset = integer(before.length - 1)
    const deleteCount = 1 + integer(Math.min(2, before.length - offset) - 1)
    net.edit(user, { offset, deleteCount, text: '' })
    expect(net.users[user]!.participant.text(), `step ${step}`).toBe(
      before.slice(0, offset) + before.slice(offset + deleteCount),
    )
  }
  net.settle()
}

test.each(counts)(
  'Yjs five-user scheduler, %i iterations',
  (iterations) => {
    runScheduler(iterations, iterations)
  },
  120_000,
)

if (process.env.COLLAB_STRESS === '1') {
  test('Yjs five-user scheduler converges across 10,000 seeded short rounds', () => {
    for (const seed of stressSeeds(10_000)) runScheduler(6, seed)
  }, 120_000)
}
