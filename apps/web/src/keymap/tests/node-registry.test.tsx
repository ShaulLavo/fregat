import { createBrowserDispatcher, detectPlatform } from '@fregat/hotkeys'
import { expect, test } from '../../../test/fixtures'
import { createKeymapNodeRegistry } from '@/keymap/state/node-registry'

function press(element: Element, key: string, modified = false) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey: modified && detectPlatform() !== 'mac',
    metaKey: modified && detectPlatform() === 'mac',
  })
  element.dispatchEvent(event)
  return event
}

test('commands contributed by separate hooks share their Composer focus node', () => {
  const dispatcher = createBrowserDispatcher({
    keymap: [
      { keys: 'Mod+S', command: 'stash', context: 'Chat > Composer' },
      { keys: 'Enter', command: 'send', context: 'Chat > Composer' },
    ],
  })
  const registry = createKeymapNodeRegistry(dispatcher)
  const parent = dispatcher.createNode({ context: 'Chat' })
  const element = document.createElement('div')
  document.body.append(element)
  const calls: string[] = []
  const registrations = ['stash', 'send'].map((command) =>
    registry.register({
      element: () => element,
      parent: () => parent,
      context: () => 'Composer',
      commands: {
        [command]: () => {
          calls.push(command)
        },
      },
    }),
  )
  try {
    expect(press(element, 's', true).defaultPrevented).toBe(true)
    expect(press(element, 'Enter').defaultPrevented).toBe(true)
    expect(calls).toEqual(['stash', 'send'])
    registrations[1]!()
    expect(press(element, 's', true).defaultPrevented).toBe(true)
    expect(calls).toEqual(['stash', 'send', 'stash'])
  } finally {
    registrations.forEach((remove) => remove())
    registry.dispose()
    dispatcher.dispose()
    element.remove()
  }
})

test('a getter root attached after registration and replaced later keeps one live handler', () => {
  const dispatcher = createBrowserDispatcher({
    keymap: [{ keys: 'Mod+S', command: 'stash', context: 'Chat > Composer' }],
  })
  const registry = createKeymapNodeRegistry(dispatcher)
  const parent = dispatcher.createNode({ context: 'Chat' })
  let element: Element | null = null
  let calls = 0
  const remove = registry.register({
    element: () => element,
    parent: () => parent,
    context: () => 'Composer',
    commands: {
      stash: () => {
        calls++
      },
    },
  })
  const first = document.createElement('div')
  const second = document.createElement('div')
  document.body.append(first, second)
  try {
    element = first
    registry.sync()
    expect(press(first, 's', true).defaultPrevented).toBe(true)
    element = second
    registry.sync()
    expect(press(first, 's', true).defaultPrevented).toBe(false)
    expect(press(second, 's', true).defaultPrevented).toBe(true)
    expect(calls).toBe(2)
  } finally {
    remove()
    registry.dispose()
    dispatcher.dispose()
    first.remove()
    second.remove()
  }
})

test('live contexts compose and a stale cleanup leaves the surviving registration attached', () => {
  const dispatcher = createBrowserDispatcher({
    keymap: [{ keys: 'Mod+S', command: 'stash', context: 'Chat > (Composer && enabled)' }],
  })
  const registry = createKeymapNodeRegistry(dispatcher)
  const parent = dispatcher.createNode({ context: 'Chat' })
  const element = document.createElement('div')
  document.body.append(element)
  let enabled = false
  let calls = 0
  const removeContext = registry.register({
    element: () => element,
    parent: () => parent,
    context: () => ({ identifiers: enabled ? ['enabled'] : [] }),
    commands: {},
  })
  const removeHandler = registry.register({
    element: () => element,
    parent: () => parent,
    context: () => 'Composer',
    commands: {
      stash: () => {
        calls++
      },
    },
  })
  try {
    expect(press(element, 's', true).defaultPrevented).toBe(false)
    enabled = true
    expect(press(element, 's', true).defaultPrevented).toBe(true)
    removeContext()
    expect(press(element, 's', true).defaultPrevented).toBe(false)
    expect(calls).toBe(1)
  } finally {
    removeContext()
    removeHandler()
    registry.dispose()
    dispatcher.dispose()
    element.remove()
  }
})
