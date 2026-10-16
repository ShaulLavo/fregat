import { afterEach, beforeEach, expect, test } from 'vitest'
import { act, createElement } from 'react'
import { mount } from '../../../test/render'
import { Command, CommandItem, CommandList } from '../../components/command'
import { Button } from '../../components/button'
import { Collapsible, CollapsibleTrigger } from '../../components/collapsible'
import { Switch } from '../../components/switch'
import { Input } from '../../components/input'
import { ListRow } from '../list-row'
import { installFeedbackListeners } from '../feedback-listeners'

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

test('non-control voices coalesce within 30 ms; error and bell have longer caps', () => {
  configureFeedback({ channels: ['controls', 'errors', 'terminalBell'], volume: 50 })
  unlockFeedback()
  playFeedback('tap', 'errors')
  clock = 20
  playFeedback('tap', 'errors')
  expect(starts).toBe(1)
  clock = 60
  playFeedback('tap', 'errors')
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

test('command items acknowledge pointer input and stay quiet on hover and keyboard activation', () => {
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
              expect(starts).toBe(selections < 2 ? 0 : 1)
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

test.each(['disabled', 'canceled'] as const)('a %s command follows its input policy', (reason) => {
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
  expect(starts).toBe(reason === 'disabled' ? 0 : 1)
})

test('an interactive selected row acknowledges pointer clicks just like a button', () => {
  configureFeedback({ channels: ['controls'], volume: 50 })
  unlockFeedback()
  let selections = 0
  const mounted = mount(
    createElement(
      'div',
      null,
      createElement(Button, null, 'Known good button'),
      createElement(
        ListRow,
        {
          selected: true,
          onClick: () => {
            selections += 1
          },
        },
        'Choice',
      ),
    ),
  )
  const dispose = installFeedbackListeners(document)
  cleanup = () => {
    dispose()
    mounted.unmount()
  }
  const button = mounted.container.querySelector('[data-slot="button"]')!
  const row = mounted.container.querySelector('[data-slot="list-row"]')!
  act(() => {
    button.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0 }),
    )
    button.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse', button: 0 }),
    )
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
  })
  expect(starts).toBe(1)
  clock = 60
  act(() => row.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })))
  expect(selections).toBe(1)
  expect(starts).toBe(2)
  clock = 120
  act(() => row.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })))
  expect(selections).toBe(2)
  expect(starts).toBe(3)
})

test('a touch press that becomes scrolling stays silent', () => {
  configureFeedback({ channels: ['controls'], volume: 50 })
  unlockFeedback()
  const mounted = mount(createElement(Button, null, 'Scrollable place'))
  const dispose = installFeedbackListeners(document)
  cleanup = () => {
    dispose()
    mounted.unmount()
  }
  const button = mounted.container.querySelector('button')!
  act(() =>
    button.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerType: 'touch',
        pointerId: 9,
        button: 0,
      }),
    ),
  )
  expect(starts).toBe(0)
  act(() =>
    button.dispatchEvent(
      new PointerEvent('pointercancel', {
        bubbles: true,
        pointerType: 'touch',
        pointerId: 9,
      }),
    ),
  )
  expect(starts).toBe(0)
})

test('separate intentional pointer activations are never coalesced together', () => {
  configureFeedback({ channels: ['controls'], volume: 50 })
  unlockFeedback()
  playControlFeedback('tick', new MouseEvent('click', { detail: 1 }))
  playControlFeedback('tick', new MouseEvent('click', { detail: 1 }))
  expect(starts).toBe(2)
})

test('nested controls acknowledge once even with manual feedback and stopped propagation', () => {
  configureFeedback({ channels: ['controls'], volume: 50 })
  unlockFeedback()
  let rowClicks = 0
  const mounted = mount(
    createElement(
      ListRow,
      {
        onClick: () => {
          rowClicks += 1
        },
      },
      createElement(
        Button,
        {
          onClick: (event) => {
            event.stopPropagation()
            playControlFeedback('tick', event.nativeEvent)
          },
        },
        'Nested action',
      ),
    ),
  )
  const dispose = installFeedbackListeners(document)
  cleanup = () => {
    dispose()
    mounted.unmount()
  }
  const button = mounted.container.querySelector('button')!
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })))
  expect(rowClicks).toBe(0)
  expect(starts).toBe(1)
})

test.each(['static', 'silent', 'disabled', 'aria-disabled'] as const)(
  '%s rows stay silent',
  (policy) => {
    configureFeedback({ channels: ['controls'], volume: 50 })
    unlockFeedback()
    const mounted = mount(
      createElement(
        ListRow,
        {
          onClick: policy === 'static' ? undefined : () => {},
          'data-feedback': policy === 'silent' ? 'silent' : undefined,
          disabled: policy === 'disabled',
          'aria-disabled': policy === 'aria-disabled' ? true : undefined,
        },
        'Row',
      ),
    )
    cleanup = mounted.unmount
    const row = mounted.container.querySelector('[data-slot="list-row"]')!
    act(() => row.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })))
    expect(starts).toBe(0)
  },
)

test('custom-styled rows acknowledge modifier clicks and keyboard clicks stay silent', () => {
  configureFeedback({ channels: ['controls'], volume: 50 })
  unlockFeedback()
  const mounted = mount(
    createElement(ListRow, { interactive: false, onClick: () => {} }, 'Tree choice'),
  )
  cleanup = mounted.unmount
  const row = mounted.container.querySelector('[data-slot="list-row"]')!
  expect(row.hasAttribute('data-row-press')).toBe(true)
  act(() => row.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })))
  expect(starts).toBe(0)
  act(() =>
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, shiftKey: true })),
  )
  act(() => row.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, ctrlKey: true })))
  expect(starts).toBe(2)
})

test.each(['for', 'wrapping'] as const)(
  '%s switch labels acknowledge the original pointer click once',
  (labelKind) => {
    configureFeedback({ channels: ['controls'], volume: 50 })
    unlockFeedback()
    let changes = 0
    const toggle = createElement(Switch, {
      id: 'labeled-toggle',
      name: 'toggle',
      uncheckedValue: 'off',
      onCheckedChange: () => {
        changes += 1
      },
    })
    const element =
      labelKind === 'wrapping'
        ? createElement('label', null, 'Switch label', toggle)
        : createElement(
            'div',
            null,
            createElement('label', { htmlFor: 'labeled-toggle' }, 'Switch label'),
            toggle,
          )
    const mounted = mount(element)
    const dispose = installFeedbackListeners(document)
    cleanup = () => {
      dispose()
      mounted.unmount()
    }
    const label = mounted.container.querySelector('label')!
    const hiddenInput = mounted.container.querySelector('input[type="checkbox"]')!
    expect(label.control).toBe(hiddenInput)
    const hiddenValue = hiddenInput.previousElementSibling!
    expect(hiddenValue.matches('input[type="hidden"]')).toBe(true)
    expect(hiddenValue.previousElementSibling?.matches('[data-slot="switch"]')).toBe(true)
    act(() => label.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })))
    expect(changes).toBe(1)
    expect(starts).toBe(1)
    act(() => hiddenInput.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })))
    expect(starts).toBe(1)
    act(() => label.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })))
    expect(starts).toBe(1)
  },
)

test('disabled switch labels and text field labels stay silent', () => {
  configureFeedback({ channels: ['controls'], volume: 50 })
  unlockFeedback()
  const mounted = mount(
    createElement(
      'div',
      null,
      createElement('label', { htmlFor: 'disabled-toggle' }, 'Disabled'),
      createElement(Switch, { id: 'disabled-toggle', disabled: true }),
      createElement('label', { htmlFor: 'text-input' }, 'Text'),
      createElement(Input, { id: 'text-input' }),
    ),
  )
  const dispose = installFeedbackListeners(document)
  cleanup = () => {
    dispose()
    mounted.unmount()
  }
  for (const label of mounted.container.querySelectorAll('label')) {
    act(() => label.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })))
  }
  expect(starts).toBe(0)
})

test.each([false, true])(
  'collapsible trigger composed with Button=%s acknowledges once',
  (composed) => {
    configureFeedback({ channels: ['controls'], volume: 50 })
    unlockFeedback()
    const mounted = mount(
      createElement(
        Collapsible,
        null,
        createElement(
          CollapsibleTrigger,
          { render: composed ? createElement(Button) : undefined },
          'Toggle',
        ),
      ),
    )
    const dispose = installFeedbackListeners(document)
    cleanup = () => {
      dispose()
      mounted.unmount()
    }
    const trigger = mounted.container.querySelector('button')!
    act(() => trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })))
    expect(starts).toBe(0)
    act(() => trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })))
    expect(starts).toBe(1)
  },
)

test('select release-generated click and its native click share the original mouseup', async () => {
  configureFeedback({ channels: ['controls'], volume: 50 })
  unlockFeedback()
  const container = document.createElement('div')
  container.innerHTML =
    '<button data-slot="select-trigger" data-feedback="tap" aria-haspopup="listbox" aria-controls="choices">Choose</button><div role="listbox" id="choices"><div data-slot="select-item" role="option" data-feedback="tick">Choice</div></div>'
  document.body.append(container)
  const dispose = installFeedbackListeners(document)
  cleanup = () => {
    dispose()
    container.remove()
  }
  const trigger = container.querySelector('button')!
  const item = container.querySelector<HTMLElement>('[data-slot="select-item"]')!
  item.addEventListener('mouseup', () => item.click())
  trigger.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      pointerType: 'mouse',
      pointerId: 1,
      button: 0,
    }),
  )
  item.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, detail: 1, clientY: 40 }))
  expect(starts).toBe(1)
  item.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
  expect(starts).toBe(1)
  await Promise.resolve()
  item.click()
  expect(starts).toBe(1)
  item.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
  expect(starts).toBe(2)
})

test('an aligned popup retargeted release acknowledges its trigger without a click', async () => {
  configureFeedback({ channels: ['controls'], volume: 50 })
  unlockFeedback()
  const container = document.createElement('div')
  container.innerHTML =
    '<button data-slot="select-trigger" data-feedback="tap" aria-haspopup="listbox" aria-controls="choices">Choose</button><div role="listbox" id="choices"><div data-slot="select-item" role="option" data-feedback="tick">Choice</div></div>'
  document.body.append(container)
  const dispose = installFeedbackListeners(document)
  cleanup = () => {
    dispose()
    container.remove()
  }
  const trigger = container.querySelector('button')!
  const item = container.querySelector<HTMLElement>('[data-slot="select-item"]')!
  trigger.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      pointerType: 'mouse',
      pointerId: 1,
      button: 0,
    }),
  )
  item.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, detail: 1 }))
  await Promise.resolve()
  expect(starts).toBe(1)
  item.click()
  expect(starts).toBe(1)
})

test('releasing over another row and canceled reorder gestures stay quiet', () => {
  configureFeedback({ channels: ['controls'], volume: 50 })
  unlockFeedback()
  const container = document.createElement('div')
  container.innerHTML =
    '<button data-feedback="tick">First</button><button data-feedback="tick">Second</button>'
  document.body.append(container)
  const dispose = installFeedbackListeners(document)
  cleanup = () => {
    dispose()
    container.remove()
  }
  const first = container.querySelectorAll('button')[0]!
  const second = container.querySelectorAll('button')[1]!
  first.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      pointerType: 'mouse',
      pointerId: 1,
      button: 0,
    }),
  )
  second.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, detail: 1 }))
  second.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
  expect(starts).toBe(0)
  first.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      pointerType: 'mouse',
      pointerId: 2,
      button: 0,
    }),
  )
  first.dispatchEvent(new Event('dragstart', { bubbles: true }))
  first.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, detail: 1 }))
  first.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
  expect(starts).toBe(0)
})

test.each([false, true])(
  'owned menu release supports submenu=%s and deduplicates the generated detail-one click',
  (submenu) => {
    configureFeedback({ channels: ['controls'], volume: 50 })
    unlockFeedback()
    const container = document.createElement('div')
    container.innerHTML =
      '<button data-feedback="tap" aria-haspopup="menu" aria-controls="menu">Open</button><div role="menu" id="menu"><div role="menuitem" aria-haspopup="menu" aria-controls="submenu">Submenu</div></div><div role="menu" id="submenu"></div>'
    document.body.append(container)
    const item = document.createElement('div')
    item.setAttribute('role', 'menuitem')
    item.dataset.feedback = 'tap'
    container.querySelector(submenu ? '#submenu' : '#menu')!.append(item)
    const dispose = installFeedbackListeners(document)
    cleanup = () => {
      dispose()
      container.remove()
    }
    const trigger = container.querySelector('button')!
    item.addEventListener('mouseup', () =>
      item.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })),
    )
    trigger.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerType: 'mouse',
        pointerId: 1,
        button: 0,
      }),
    )
    item.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, detail: 1, clientY: 40 }))
    expect(starts).toBe(1)
    item.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(starts).toBe(1)
  },
)

test('a stopped mouseup dispatch lends provenance only to its synchronous generated click', () => {
  configureFeedback({ channels: ['controls'], volume: 50 })
  unlockFeedback()
  const container = document.createElement('div')
  container.innerHTML =
    '<button data-feedback="tap" aria-haspopup="listbox" aria-controls="choices">Choose</button><div role="listbox" id="choices"><div role="option" data-feedback="tick">Choice</div></div>'
  document.body.append(container)
  const dispose = installFeedbackListeners(document)
  cleanup = () => {
    dispose()
    container.remove()
  }
  const trigger = container.querySelector('button')!
  const item = container.querySelector<HTMLElement>('[role="option"]')!
  item.addEventListener('mouseup', (event) => {
    item.click()
    event.stopPropagation()
  })
  trigger.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      pointerType: 'mouse',
      pointerId: 1,
      button: 0,
    }),
  )
  item.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, detail: 1, clientY: 40 }))
  expect(starts).toBe(1)
  item.click()
  expect(starts).toBe(1)
})
