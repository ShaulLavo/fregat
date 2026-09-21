import { createSearchBufferStore } from '@/features/search/state/buffer-state'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { TEST_ENVIRONMENT_ID } from '../../../../test/factories/chat'
import {
  attachSearchResultScroll,
  searchResultScrollState,
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
  expect(state.read('const').top).toBe(4_200)
  detachMoved()
  moved.remove()
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
