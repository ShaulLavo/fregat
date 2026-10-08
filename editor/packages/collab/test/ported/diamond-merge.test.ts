// josephg/diamond-types @ 89ae3a0ab8d941a2885e6ec89d094bc9ce9d2922.
// src/list/oplog_merge_fuzzer.rs, oplog_merge_fuzz_once (seed 1000139);
// src/list/gen_random.rs, gen_oplog and generates_simple_oplog (seed 123).
// Adapted to Singapore ID-space edits: pair merges consume a host log prefix.
// ISC, Seph Gentle and Diamond Types contributors. See ../../THIRD_PARTY_TEST_NOTICES.md.
// The RNG is adapted; seed numbers do not reproduce Rust SmallRng's exact stream.
import { expect, test } from 'vitest'
import { network, randomSource } from './adapter'
import { randomChange } from './diamond-workload'

const stress = process.env.COLLAB_STRESS === '1'
const seeds = [1000139, 123, ...Array.from({ length: stress ? 100 : 8 }, (_, index) => index)]

test.each(seeds)(
  'Diamond Types host-adapted merge fuzz, seed %i',
  (seed) => {
    const net = network(3)
    const random = randomSource(seed)
    const choose = (bound: number) => Math.floor(random() * bound)
    const rounds = seed === 1000139 || stress ? 100 : 10
    const changes = seed === 123 ? 5 : 2
    for (let round = 0; round < rounds; round++) {
      for (let step = 0; step < changes; step++) {
        const user = choose(3)
        const change = randomChange(net.users[user]!.participant.text(), random)
        for (const edit of change.edits) net.edit(user, edit)
        expect(net.users[user]!.participant.text(), `round ${round}, change ${step}`).toBe(
          change.text,
        )
      }
      const a = choose(3)
      let b = choose(2)
      if (b >= a) b++
      net.sync([a, b])
      if (round % 50 === 0) net.sync([0, 1, 2])
    }
    net.settle()
  },
  30_000,
)
