import { test, expect } from '../../../test/fixtures'
import { createObservableStore } from '@/host/state/observable-store'

test('replaces and patches snapshots and stops notifying after unsubscribe or disposal', () => {
  const store = createObservableStore({ count: 0, label: 'first' })
  const seen: number[] = []
  const unsubscribe = store.subscribe(() => seen.push(store.value.count))
  store.replace({ count: 1, label: 'second' })
  store.patch({ count: 2 })
  expect(store.getSnapshot()).toEqual({ count: 2, label: 'second' })
  expect(store.getSnapshot()).toBe(store.value)
  expect(seen).toEqual([1, 2])
  unsubscribe()
  store.patch({ count: 3 })
  expect(seen).toEqual([1, 2])
  store.subscribe(() => seen.push(store.value.count))
  store.dispose()
  store.replace({ count: 4, label: 'ignored' })
  expect(store.value.count).toBe(3)
  expect(seen).toEqual([1, 2])
})

test('parent abort stops publication and an already aborted parent never starts a store', () => {
  const parent = new AbortController()
  const store = createObservableStore(0, { signal: parent.signal })
  let calls = 0
  store.subscribe(() => (calls += 1))
  store.replace(1)
  parent.abort()
  store.replace(2)
  expect(store.value).toBe(1)
  expect(calls).toBe(1)
  const aborted = createObservableStore(5, { signal: parent.signal })
  aborted.subscribe(() => (calls += 1))
  aborted.replace(6)
  expect(aborted.value).toBe(5)
  expect(calls).toBe(1)
})
