import { createSearchBufferStore } from '@/features/search/state/buffer-state'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { TEST_ENVIRONMENT_ID } from '../../../../test/factories/chat'
import {
  attachSearchResultScroll,
  searchResultScrollState,
  searchScrollRowAt,
  prepareSearchReload,
} from '@/features/search/state/result-scroll-state'
import { expect, test } from '../../../../test/fixtures'

test('moving search to another container restores its latest scroll before a scroll event', () => {
  const state = searchResultScrollState({})
  const first = document.createElement('div')
  document.body.append(first)
  const detach = attachSearchResultScroll({
    element: first,
    query: 'const',
    scrollToOffset: (offset) => {
      first.scrollTop = offset
    },
    state,
  })
  first.scrollTop = 3_150
  detach()
  first.remove()

  const moved = document.createElement('div')
  document.body.append(moved)
  const detachMoved = attachSearchResultScroll({
    element: moved,
    query: 'const',
    scrollToOffset: (offset) => {
      moved.scrollTop = offset
    },
    state,
  })

  expect(moved.scrollTop).toBe(3_150)
  moved.scrollTop = 4_200
  moved.dispatchEvent(new Event('scroll'))
  expect(state.snapshot().viewport.top).toBe(4_200)
  detachMoved()
  moved.remove()
})

test('scroll events read no layout; the position is read once when it is asked for', () => {
  const state = searchResultScrollState({})
  const element = document.createElement('div')
  document.body.append(element)
  let top = 0
  let reads = 0
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => {
      reads += 1
      return top
    },
    set: (value: number) => {
      top = value
    },
  })
  const rows = Array.from({ length: 1_000 }, (_, index) => ({
    key: `row-${index}`,
    start: index * 28,
    size: 28,
  }))
  const detach = attachSearchResultScroll({
    element,
    query: 'const',
    scrollToOffset: (offset) => {
      element.scrollTop = offset
    },
    state,
    geometry: rows,
  })
  reads = 0

  for (let step = 1; step <= 50; step += 1) {
    top = step * 100
    element.dispatchEvent(new Event('scroll'))
  }
  expect(reads).toBe(0)

  element.dispatchEvent(new Event('scrollend'))
  expect(reads).toBe(1)
  expect(state.snapshot()).toEqual({
    query: 'const',
    viewport: { height: 0, top: 5_000 },
    anchor: { id: 'row-178', fraction: 16 / 28 },
  })
  expect(reads).toBe(1)
  detach()
  element.remove()
})

test('the anchor row is found by offset over sorted rows', () => {
  const rows = [
    { key: 'a', start: 0, size: 22 },
    { key: 'b', start: 22, size: 100 },
    { key: 'c', start: 122, size: 28 },
  ]

  expect(searchScrollRowAt(rows, 0)?.key).toBe('a')
  expect(searchScrollRowAt(rows, 21.5)?.key).toBe('a')
  expect(searchScrollRowAt(rows, 22)?.key).toBe('b')
  expect(searchScrollRowAt(rows, 149)?.key).toBe('c')
  expect(searchScrollRowAt(rows, 150)).toBeUndefined()
  expect(searchScrollRowAt([], 10)).toBeUndefined()
})

test('detaching a removed container does not replace the retained viewport with zeroes', () => {
  const state = searchResultScrollState({})
  state.remember('const', { height: 700, top: 3_150 })
  const element = document.createElement('div')
  document.body.append(element)
  const detach = attachSearchResultScroll({
    element,
    query: 'const',
    scrollToOffset: (offset) => {
      element.scrollTop = offset
    },
    state,
  })

  element.remove()
  element.scrollTop = 0
  detach()

  expect(state.read('const')).toEqual({ height: 700, top: 3_150 })
})

test('a new displayed query starts at the top and buffer incarnations keep separate positions', () => {
  const incarnation = {}
  const state = searchResultScrollState(incarnation)
  state.remember('const', { height: 700, top: 3_150 })

  expect(searchResultScrollState(incarnation).read('const')).toEqual({ height: 700, top: 3_150 })
  expect(searchResultScrollState({}).read('const').top).toBe(0)
  expect(state.read('function')).toEqual({ height: 700, top: 0 })

  const element = document.createElement('div')
  const detach = attachSearchResultScroll({
    element,
    query: 'function',
    scrollToOffset: (offset) => {
      element.scrollTop = offset
    },
    state,
  })
  expect(element.scrollTop).toBe(0)
  expect(state.read('const').top).toBe(0)
  detach()
})

test('reload restores each renderer and reprojects the anchor for a changed density', () => {
  const values = new Map<string, string>()
  const storage: ScopedStorage = {
    environmentId: TEST_ENVIRONMENT_ID,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
      return 'written'
    },
    removeItem: (key) => {
      values.delete(key)
    },
    keys: (prefix) => [...values.keys()].filter((key) => key.startsWith(prefix)),
  }
  const first = createSearchBufferStore()
  const buffer = first.getState().prepareBuffer('repo')
  const dispose = prepareSearchReload(first, storage)
  const query = JSON.stringify({ query: 'needle', caseSensitive: true })
  searchResultScrollState(buffer.incarnation, 'compact').remember(query, { height: 400, top: 45 }, [
    { key: 'row-a', start: 0, size: 30 },
    { key: 'row-b', start: 30, size: 30 },
  ])
  searchResultScrollState(buffer.incarnation, 'editor').remember(query, { height: 500, top: 900 })
  dispose()
  const second = createSearchBufferStore()
  const restored = second.getState().prepareBuffer('repo')
  const stop = prepareSearchReload(second, storage)
  expect(
    searchResultScrollState(restored.incarnation, 'compact').read(query, [
      { key: 'row-a', start: 0, size: 20 },
      { key: 'row-b', start: 20, size: 20 },
    ]),
  ).toEqual({ height: 400, top: 30 })
  expect(searchResultScrollState(restored.incarnation, 'editor').read(query).top).toBe(900)
  expect(
    searchResultScrollState(restored.incarnation, 'compact').read(
      JSON.stringify({ query: 'needle', caseSensitive: false }),
    ).top,
  ).toBe(0)
  stop()
})
