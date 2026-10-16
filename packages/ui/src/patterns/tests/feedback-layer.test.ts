import { afterEach, beforeEach, expect, test } from 'vitest'
import { act, createElement } from 'react'
import { mount } from '../../../test/render'
import { Command, CommandItem, CommandList } from '../../components/command'

import {
  configureFeedback,
  feedbackOutput,
  playFeedback,
  playControlFeedback,
  resetFeedbackForTest,
  unlockFeedback,
} from '@workspace/ui/patterns/feedback-layer'

let clock = 0
let hidden = false
let starts = 0
let cleanup = () => {}

// The audio boundary: counts what would reach the speaker.
function fakeContext() {
  const node = () => ({ connect: (next: unknown) => next })
  return {
    state: 'running',
    sampleRate: 48_000,
    currentTime: 0,
    destination: {},
    resume: () => Promise.resolve(),
    createGain: () => ({ ...node(), gain: { value: 0 } }),
    createBiquadFilter: () => ({ ...node(), type: '', Q: { value: 0 }, frequency: { value: 0 } }),
    createBuffer: (_channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    }),
    createBufferSource: () => ({
      ...node(),
      buffer: null,
      start: () => {
        starts += 1
      },
    }),
  } as unknown as AudioContext
}

beforeEach(() => {
  clock = 0
  hidden = false
  starts = 0
  resetFeedbackForTest({ createContext: fakeContext, now: () => clock, hidden: () => hidden })
})

afterEach(() => {
  cleanup()
  cleanup = () => {}
  configureFeedback({ channels: [], volume: 50 })
})

test('nothing sounds before a gesture unlocks the context', () => {
  configureFeedback({ channels: ['errors'], volume: 50 })
  playFeedback('error', 'errors')
  expect(starts).toBe(0)
  document.dispatchEvent(new Event('pointerdown'))
  playFeedback('error', 'errors')
  expect(starts).toBe(3)
})

test('a channel that is off stays silent and the others still sound', () => {
  configureFeedback({ channels: ['git'], volume: 50 })
  unlockFeedback()
  playFeedback('bell', 'terminalBell')
  expect(starts).toBe(0)
  playFeedback('success', 'git')
  expect(starts).toBe(2)
})

test('one voice coalesces within 30 ms; error and bell have longer caps', () => {
  configureFeedback({ channels: ['controls', 'errors', 'terminalBell'], volume: 50 })
  unlockFeedback()
  playFeedback('tap', 'controls')
  clock = 20
  playFeedback('tap', 'controls')
  expect(starts).toBe(1)
  clock = 60
  playFeedback('tap', 'controls')
  expect(starts).toBe(2)

  playFeedback('bell', 'terminalBell')
  clock = 400
  playFeedback('bell', 'terminalBell')
  expect(starts).toBe(3)
  clock = 600
  playFeedback('bell', 'terminalBell')
  expect(starts).toBe(4)

  playFeedback('error', 'errors')
  clock = 2000
  playFeedback('error', 'errors')
  expect(starts).toBe(7)
})

test('a hidden tab silences everything but agent notices', () => {
  configureFeedback({ channels: ['errors', 'agent'], volume: 50 })
  unlockFeedback()
  hidden = true
  playFeedback('error', 'errors')
  expect(starts).toBe(0)
  expect(feedbackOutput('agent')).not.toBeNull()
})

test('pointer commits sound, keyboard and programmatic commits stay silent', () => {
  configureFeedback({ channels: ['controls'], volume: 50 })
  unlockFeedback()
  playControlFeedback('tick', new KeyboardEvent('keydown', { key: 'Enter' }))
  playControlFeedback('tick', new MouseEvent('click', { detail: 0 }))
  expect(starts).toBe(0)
  playControlFeedback('tick', new MouseEvent('click', { detail: 1 }))
  expect(starts).toBe(1)
})

test('command items tick after pointer selection and stay quiet on hover and keyboard activation', () => {
  configureFeedback({ channels: ['controls'], volume: 50 })
  unlockFeedback()
  let selections = 0
  const mounted = mount(
    createElement(
      Command,
      null,
      createElement(
        CommandList,
        null,
        createElement(
          CommandItem,
          {
            value: 'choice',
            onSelect: () => {
              expect(starts).toBe(0)
              selections += 1
            },
          },
          'Choice',
        ),
      ),
    ),
  )
  cleanup = mounted.unmount
  const item = mounted.container.querySelector('[data-slot="command-item"]')!
  const command = mounted.container.querySelector('[cmdk-root]')!
  act(() =>
    item.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' })),
  )
  expect(starts).toBe(0)
  act(() => command.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  act(() => item.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })))
  expect(selections).toBe(2)
  expect(starts).toBe(0)
  act(() => item.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })))
  expect(selections).toBe(3)
  expect(starts).toBe(1)
})

test.each(['disabled', 'canceled'] as const)('a %s command item stays silent', (reason) => {
  configureFeedback({ channels: ['controls'], volume: 50 })
  unlockFeedback()
  let selections = 0
  const mounted = mount(
    createElement(
      Command,
      {
        onClick: (event) => {
          if (reason === 'canceled') event.preventDefault()
        },
      },
      createElement(
        CommandList,
        null,
        createElement(
          CommandItem,
          {
            value: 'choice',
            disabled: reason === 'disabled',
            onSelect: () => {
              selections += 1
            },
          },
          'Choice',
        ),
      ),
    ),
  )
  cleanup = mounted.unmount
  const item = mounted.container.querySelector('[data-slot="command-item"]')!
  act(() =>
    item.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, cancelable: true })),
  )
  expect(selections).toBe(reason === 'disabled' ? 0 : 1)
  expect(starts).toBe(0)
})
