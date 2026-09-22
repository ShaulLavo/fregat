import { expect, test } from '../../../test/fixtures'
import { createMarkerStore } from '@/lib/markers/store'

const A = 'file:///repo/a.ts'
const B = 'file:///repo/b.ts'

function marker(severity: 1 | 2 | 3 | 4, message = 'boom') {
  return {
    message,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    severity,
  }
}

test('a publish replaces that owner’s markers for the file and leaves other owners alone', () => {
  const store = createMarkerStore()
  store.changeOne('tsserver', A, [marker(1), marker(2)])
  store.changeOne('eslint', A, [marker(2)])
  expect(store.total()).toBe(3)

  // The protocol republishes a file's whole set, so this is a replace, not a merge.
  store.changeOne('tsserver', A, [marker(1)])
  expect(store.total()).toBe(2)
  expect(store.forUri(A)?.counts.warning).toBe(1)

  // And an empty publish deletes only that pair.
  store.changeOne('tsserver', A, [])
  expect(store.total()).toBe(1)
  expect(store.forUri(A)?.counts.error).toBe(0)
})

test('removing an owner retires its markers everywhere without touching the others', () => {
  const store = createMarkerStore()
  store.changeOne('tsserver', A, [marker(1)])
  store.changeOne('tsserver', B, [marker(1)])
  store.changeOne('eslint', B, [marker(3)])

  store.removeOwner('tsserver')
  expect(store.total()).toBe(1)
  expect(store.forUri(A)).toBeNull()
  expect(store.forUri(B)?.counts.information).toBe(1)
})

test('resources lead with the worst severity, then sort by path', () => {
  const store = createMarkerStore()
  store.changeOne('tsserver', B, [marker(1)])
  store.changeOne('tsserver', A, [marker(2)])
  store.changeOne('tsserver', 'file:///repo/c.ts', [marker(2)])

  expect(store.resources().map((resource) => resource.path)).toEqual([
    'repo/b.ts',
    'repo/a.ts',
    'repo/c.ts',
  ])
})

test('a subscriber hears a real change and the resource list is rebuilt, not stale', () => {
  const store = createMarkerStore()
  let notifications = 0
  const stop = store.subscribe(() => {
    notifications += 1
  })

  store.changeOne('tsserver', A, [marker(1)])
  const first = store.resources()
  store.changeOne('tsserver', A, [marker(1), marker(2)])
  expect(notifications).toBe(2)
  expect(store.resources()).not.toBe(first)
  expect(store.resources()[0]?.summary.counts.total).toBe(2)

  // A no-op delete of a pair that was never held must not wake anyone.
  store.changeOne('eslint', B, [])
  expect(notifications).toBe(2)

  stop()
  store.clear()
  expect(notifications).toBe(2)
})
