import { fireEvent } from '@testing-library/react'

import { attachTimelineNavigationListeners } from '@/features/chat/state/timeline-navigation'
import type { TimelineScrollEvent } from '@/features/chat/utils/timeline-scroll-anchoring'
import { expect, test } from '../../../../../test/fixtures'

test('an upward wheel inside scrolled tool output keeps the transcript following', () => {
  const { events, output, release } = navigationFixture()
  output.scrollTop = 80
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  output.append(icon)

  fireEvent.wheel(icon, { deltaY: -40 })

  expect(events).toEqual([])
  release()
})

test('an upward wheel at the tool output boundary releases transcript following', () => {
  const { events, output, release } = navigationFixture()

  fireEvent.wheel(output, { deltaY: -40 })

  expect(events).toEqual([{ type: 'user-navigated' }])
  release()
})

test('keyboard navigation stays inside tool output until it reaches its top', () => {
  const { events, output, release } = navigationFixture()
  output.scrollTop = 80

  fireEvent.keyDown(output, { key: 'PageUp' })
  expect(events).toEqual([])
  output.scrollTop = 0
  fireEvent.keyDown(output, { key: 'PageUp' })

  expect(events).toEqual([{ type: 'user-navigated' }])
  release()
})

test('editing text and modified arrow shortcuts do not change transcript following', () => {
  const { events, output, release } = navigationFixture()
  const input = document.createElement('textarea')
  output.append(input)

  fireEvent.keyDown(input, { key: 'ArrowUp' })
  fireEvent.keyDown(output, { ctrlKey: true, key: 'ArrowUp' })
  fireEvent.keyDown(input, { ctrlKey: true, key: 'Home' })

  expect(events).toEqual([])
  release()
})

test('native document-start shortcuts release transcript following', () => {
  const { events, output, release } = navigationFixture()

  fireEvent.keyDown(output, { ctrlKey: true, key: 'Home' })
  fireEvent.keyDown(output, { metaKey: true, key: 'ArrowUp' })

  expect(events).toEqual([{ type: 'user-navigated' }, { type: 'user-navigated' }])
  release()
})

test('navigation at an output boundary stays in its scrollable parent group', () => {
  const { events, output, release } = navigationFixture()
  const group = document.createElement('div')
  group.dataset.toolGroupScroll = ''
  group.style.overflowY = 'auto'
  output.replaceWith(group)
  group.append(output)
  group.scrollTop = 80

  fireEvent.wheel(output, { deltaY: -40 })
  fireEvent.keyDown(output, { key: 'PageUp' })

  expect(events).toEqual([])
  release()
})

function navigationFixture() {
  const element = document.createElement('div')
  const output = document.createElement('pre')
  const events: TimelineScrollEvent[] = []
  Object.defineProperties(element, {
    clientHeight: { value: 600 },
    scrollHeight: { value: 2000 },
  })
  element.scrollTop = 1400
  output.dataset.toolGroupScroll = ''
  output.style.overflowY = 'auto'
  element.append(output)
  document.body.append(element)
  const detach = attachTimelineNavigationListeners({
    dispatch: (event) => events.push(event),
    element,
    suspendForDisclosure() {},
  })

  return {
    events,
    output,
    release() {
      detach()
      element.remove()
    },
  }
}
