import { afterEach, expect, test } from 'vitest'
import { createBrowserDispatcher } from '../../src'
import type { BrowserDispatcher, KeyResetReason } from '../../src'

let dispatcher: BrowserDispatcher | undefined
afterEach(() => {
  dispatcher?.dispose()
  dispatcher = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(document, 'visibilityState')
})

function key(type: 'keydown' | 'keyup', target: Element, value = 'a') {
  const event = new KeyboardEvent(type, {
    key: value,
    code: `Key${value.toUpperCase()}`,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    composed: true,
  })
  target.dispatchEvent(event)
  return event
}

test('a late observer delivers native-owned releases once before consumption', () => {
  const input = document.createElement('textarea')
  document.body.append(input)
  const native: string[] = []
  const held = new Set<string>()
  const observed: KeyboardEvent[] = []
  input.addEventListener('keyup', (event) => native.push(`ordinary:${event.code}`))
  dispatcher = createBrowserDispatcher({
    platform: 'linux',
    keymap: [
      { keys: 'Control+A', command: 'native.send', context: 'Terminal' },
      { keys: 'Control+B', command: 'app.toggle', context: 'Terminal' },
    ],
  })
  const node = dispatcher.createNode({
    context: 'Terminal',
    commands: {
      'native.send': ({ source }) => {
        held.add(source!.code)
        native.push(`keydown:${source!.code}`)
      },
      'app.toggle': () => {},
    },
  })
  dispatcher.attachElement(node, input)
  dispatcher.observeKeys({
    beforeKey: (event) => {
      observed.push(event)
      if (event.type === 'keyup' && held.delete(event.code)) native.push(`keyup:${event.code}`)
    },
  })

  key('keydown', input)
  const release = key('keyup', input)
  expect(dispatcher.claimKeybinding(release)).toBe(true)
  expect(dispatcher.claimKeybinding(release)).toBe(true)
  expect(observed.filter((event) => event === release)).toHaveLength(1)
  expect(release.defaultPrevented).toBe(true)
  key('keydown', input, 'b')
  expect(key('keyup', input, 'b').defaultPrevented).toBe(true)
  key('keydown', input, 'x')
  expect(key('keyup', input, 'x').defaultPrevented).toBe(false)
  expect(native).toEqual(['keydown:KeyA', 'keyup:KeyA', 'ordinary:KeyX'])
})

test('focus movement leaves a native release with its original host', () => {
  const first = document.createElement('textarea')
  const second = document.createElement('textarea')
  document.body.append(first, second)
  const deliveries: string[] = []
  dispatcher = createBrowserDispatcher({
    platform: 'linux',
    keymap: [{ keys: 'Control+A', command: 'native.send', context: 'Terminal' }],
  })
  for (const [name, input] of [
    ['first', first],
    ['second', second],
  ] as const) {
    const held = new Set<string>()
    const node = dispatcher.createNode({
      context: 'Terminal',
      commands: {
        'native.send': ({ source }) => {
          held.add(source!.code)
          deliveries.push(`${name}:keydown`)
        },
      },
    })
    dispatcher.attachElement(node, input)
    dispatcher.observeKeys({
      beforeKey: (event) => {
        if (event.type === 'keyup' && held.delete(event.code)) deliveries.push(`${name}:keyup`)
      },
    })
  }
  first.focus()
  key('keydown', first)
  second.focus()
  key('keydown', second, 'x')
  key('keyup', second)
  expect(deliveries).toEqual(['first:keydown', 'first:keyup'])
})

test.each(['blur', 'hidden', 'releaseAll'] as const)(
  '%s resets native ownership with dispatcher ownership',
  (reason) => {
    const input = document.createElement('textarea')
    document.body.append(input)
    const held = new Set<string>()
    const releases: string[] = []
    const resets: KeyResetReason[] = []
    dispatcher = createBrowserDispatcher({
      platform: 'linux',
      keymap: [{ keys: 'Control+A', command: 'native.send', context: 'Terminal' }],
    })
    dispatcher.attachElement(
      dispatcher.createNode({
        context: 'Terminal',
        commands: { 'native.send': ({ source }) => void held.add(source!.code) },
      }),
      input,
    )
    dispatcher.observeKeys({
      beforeKey: (event) => {
        if (event.type === 'keyup' && held.delete(event.code)) releases.push(event.code)
      },
      reset: (value) => {
        held.clear()
        resets.push(value)
      },
    })
    key('keydown', input)
    if (reason === 'blur') window.dispatchEvent(new Event('blur'))
    if (reason === 'hidden') {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    }
    if (reason === 'releaseAll') dispatcher.releaseAll()
    expect(key('keyup', input).defaultPrevented).toBe(false)
    expect(held.size).toBe(0)
    expect(releases).toEqual([])
    expect(resets).toEqual([reason])
  },
)

test('unsubscription and disposal stop observation and dispose resets once', () => {
  const input = document.createElement('textarea')
  document.body.append(input)
  const observed: string[] = []
  const resets: string[] = []
  dispatcher = createBrowserDispatcher({ platform: 'linux' })
  const unsubscribe = dispatcher.observeKeys({
    beforeKey: () => observed.push('removed'),
    reset: () => resets.push('removed'),
  })
  unsubscribe()
  unsubscribe()
  dispatcher.observeKeys({
    beforeKey: () => observed.push('active'),
    reset: (reason) => resets.push(reason),
  })
  key('keydown', input)
  dispatcher.dispose()
  dispatcher.dispose()
  dispatcher.observeKeys({ beforeKey: () => observed.push('late') })
  key('keyup', input)
  expect(observed).toEqual(['active'])
  expect(resets).toEqual(['dispose'])
})

test('reentrant offers cannot repeat observation or matching', () => {
  const input = document.createElement('textarea')
  document.body.append(input)
  const observed: KeyboardEvent[] = []
  const commands: string[] = []
  dispatcher = createBrowserDispatcher({
    platform: 'linux',
    keymap: [{ keys: 'Control+A', command: 'send', context: 'Terminal' }],
  })
  dispatcher.attachElement(
    dispatcher.createNode({
      context: 'Terminal',
      commands: { send: () => void commands.push('send') },
    }),
    input,
  )
  dispatcher.observeKeys({
    beforeKey: (event) => {
      observed.push(event)
      expect(dispatcher!.claimKeybinding(event)).toBe(true)
    },
  })
  const press = key('keydown', input)
  expect(dispatcher.claimKeybinding(press)).toBe(true)
  expect(observed).toEqual([press])
  expect(commands).toEqual(['send'])
  expect(key('keydown', input, 'x').defaultPrevented).toBe(false)
})
