import {
  attachSearchResultScroll,
  searchResultScrollState,
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
