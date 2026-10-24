import { expect, test } from 'vitest'
import { createEngine } from './engine-fixture'
import {
  causalOrder,
  concurrentHistory,
  direct,
  historyAuthor,
  identityState,
} from './order-fixtures'

const stress = process.env.COLLAB_STRESS === '1'
const seeds = Array.from({ length: stress ? 16 : 3 }, (_, index) => index + 1)
const orders = 1_024

for (const effects of [false, true]) {
  test.each(seeds)(
    `fixed edit sets are order-independent, effects=${effects}, seed=%i`,
    (seed) => {
      const edits = concurrentHistory(seed, effects, stress ? 120 : 8)
      const baseline = direct(edits)
      const expected = identityState(baseline.engine)
      expect(expected).toEqual({
        text: baseline.oracle.text(),
        ids: baseline.oracle.ids(),
        visibleIds: baseline.oracle.visibleIds(),
      })
      const permutations = new Set<string>()
      for (let order = 0; order < orders; order++) {
        const delivery = causalOrder(edits, seed * 100_000 + order)
        permutations.add(
          delivery.map((edit) => `${edit.envelope.id.actor}.${edit.envelope.id.seq}`).join(','),
        )
        const actual = direct(delivery)
        const hostFree = createEngine()
        for (const edit of delivery) hostFree.apply(edit.envelope)
        expect(identityState(hostFree), `host-free seed=${seed}, order=${order}`).toEqual(expected)
        expect(identityState(actual.engine), `seed=${seed}, order=${order}`).toEqual(expected)
        expect(actual.oracle.text()).toBe(expected.text)
        expect(actual.oracle.ids()).toEqual(expected.ids)
        expect(actual.oracle.visibleIds()).toEqual(expected.visibleIds)
        expect(actual.host.hostSequence).toBe(edits.length)
      }
      expect(permutations.size).toBe(orders)
    },
    120_000,
  )
}

test('unordered same-owner effect writes retain last-arrival behavior', () => {
  const author = historyAuthor('actor0')
  const insert = author.author({ offset: 0, deleteCount: 0, text: 'x' })
  const undo = author.author({ target: insert.envelope, active: false })
  const redo = author.author({ target: insert.envelope, active: true })
  // A real Participant depends on its previous effect. Removing that edge creates a forked owner.
  const unorderedRedo = {
    ...redo,
    envelope: { ...redo.envelope, deps: undo.envelope.deps },
  }
  const forward = direct([insert, undo, unorderedRedo])
  const backward = direct([insert, unorderedRedo, undo])
  expect(forward.host.hostSequence).toBe(3)
  expect(backward.host.hostSequence).toBe(3)
  expect(forward.engine.text()).toBe('x')
  expect(backward.engine.text()).toBe('')
  expect(identityState(forward.engine).ids).toEqual(identityState(backward.engine).ids)
  expect(forward.oracle.text()).toBe('x')
  expect(backward.oracle.text()).toBe('')
})

test('each fixed edit set covers at least 1,000 arrival orders', () => {
  expect(orders).toBeGreaterThanOrEqual(1_000)
  console.log(
    `CRDT-direct ordering: ${orders} distinct orders per fixed edit set; ${seeds.length * orders} orders per effects mode per engine; ${seeds.length} seeds; 3–5 authors; effects on/off`,
  )
})
