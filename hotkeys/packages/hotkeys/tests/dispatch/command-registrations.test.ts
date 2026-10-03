import { afterEach, expect, test } from 'vitest'
import { createDispatcher, createKeyInput } from '../../src'
import type { Dispatcher } from '../../src'

let dispatcher: Dispatcher<unknown> | undefined
afterEach(() => {
  dispatcher?.dispose()
  dispatcher = undefined
})

test.each(['focused', 'origin', 'keyboard'] as const)(
  'self-resubscription waits for the next %s command notification',
  (route) => {
    const keys = createDispatcher({
      platform: 'linux',
      keymap: [{ keys: 'Control+B', command: 'send' }],
    })
    dispatcher = keys
    const node = keys.createNode()
    node.focus()
    let calls = 0
    let remove = () => {}
    const handler = () => {
      calls += 1
      // Bound the live-Set negative control so it cannot hang command dispatch.
      if (calls < 3) {
        remove()
        remove = node.handle('send', handler)
      }
      return false
    }
    remove = node.handle('send', handler)
    const send = () => {
      if (route === 'origin') return keys.dispatchCommandFrom(node, 'send')
      if (route === 'focused') return keys.dispatchCommand('send')
      return keys.handleKey(
        createKeyInput({ key: 'b', code: 'KeyB', modifiers: { ctrl: true } }),
        null,
      )
    }
    expect(send()).toBe(false)
    expect(calls).toBe(1)
    expect(send()).toBe(false)
    expect(calls).toBe(2)
    remove()
  },
)

test('replacing another handler before its turn defers its new registration', () => {
  const keys = createDispatcher()
  dispatcher = keys
  const node = keys.createNode()
  const calls: string[] = []
  let first = true
  let removeSecond = () => {}
  const second = () => void calls.push('second')
  node.handle('send', () => {
    calls.push('first')
    if (first) {
      first = false
      removeSecond()
      removeSecond = node.handle('send', second)
    }
    return false
  })
  removeSecond = node.handle('send', second)
  expect(keys.dispatchCommandFrom(node, 'send')).toBe(false)
  expect(calls).toEqual(['first'])
  expect(keys.dispatchCommandFrom(node, 'send')).toBe(true)
  expect(calls).toEqual(['first', 'first', 'second'])
})

test('a child adding a parent handler defers it until the next whole-path notification', () => {
  const keys = createDispatcher()
  dispatcher = keys
  const parent = keys.createNode()
  const child = keys.createNode({ parent })
  const calls: string[] = []
  let first = true
  child.handle('send', () => {
    calls.push('child')
    if (first) {
      first = false
      parent.handle('send', () => void calls.push('parent'))
    }
    return false
  })
  expect(keys.dispatchCommandFrom(child, 'send')).toBe(false)
  expect(calls).toEqual(['child'])
  expect(keys.dispatchCommandFrom(child, 'send')).toBe(true)
  expect(calls).toEqual(['child', 'child', 'parent'])
})

test('removing another handler before its turn skips it and retains ancestor fallback', () => {
  const keys = createDispatcher()
  dispatcher = keys
  const calls: string[] = []
  const parent = keys.createNode({ commands: { send: () => void calls.push('parent') } })
  const child = keys.createNode({ parent })
  let removeSecond = () => {}
  child.handle('send', () => {
    calls.push('first')
    removeSecond()
    return false
  })
  removeSecond = child.handle('send', () => void calls.push('removed'))
  expect(keys.dispatchCommandFrom(child, 'send')).toBe(true)
  expect(calls).toEqual(['first', 'parent'])
})

test('removing the current node during decline skips its remaining handlers', () => {
  const keys = createDispatcher()
  dispatcher = keys
  const calls: string[] = []
  const parent = keys.createNode({ commands: { send: () => void calls.push('parent') } })
  const child = keys.createNode({ parent })
  child.handle('send', () => {
    calls.push('remove')
    child.remove()
    return false
  })
  child.handle('send', () => void calls.push('stale'))
  expect(keys.dispatchCommandFrom(child, 'send')).toBe(true)
  expect(calls).toEqual(['remove', 'parent'])
})

test('removing an ancestor during decline skips the newly orphaned child path', () => {
  const keys = createDispatcher()
  dispatcher = keys
  const calls: string[] = []
  const root = keys.createNode({ commands: { send: () => void calls.push('root') } })
  const parent = keys.createNode({ parent: root })
  const child = keys.createNode({ parent })
  child.handle('send', () => {
    calls.push('remove')
    parent.remove()
    return false
  })
  child.handle('send', () => void calls.push('stale'))
  expect(keys.dispatchCommandFrom(child, 'send')).toBe(true)
  expect(calls).toEqual(['remove', 'root'])
})

test('disposal during decline stops the remaining path notification', () => {
  const keys = createDispatcher()
  dispatcher = keys
  const calls: string[] = []
  const parent = keys.createNode({ commands: { send: () => void calls.push('parent') } })
  const child = keys.createNode({ parent })
  child.handle('send', () => {
    calls.push('dispose')
    keys.dispose()
    return false
  })
  child.handle('send', () => void calls.push('stale'))
  expect(keys.dispatchCommandFrom(child, 'send')).toBe(false)
  expect(calls).toEqual(['dispose'])
})

test('identical handler subscriptions have independent removal', () => {
  const keys = createDispatcher()
  dispatcher = keys
  const node = keys.createNode()
  let calls = 0
  const handler = () => {
    calls += 1
    return false
  }
  const removeFirst = node.handle('send', handler)
  const removeSecond = node.handle('send', handler)
  removeFirst()
  expect(keys.dispatchCommandFrom(node, 'send')).toBe(false)
  expect(calls).toBe(1)
  removeSecond()
  expect(keys.dispatchCommandFrom(node, 'send')).toBe(false)
  expect(calls).toBe(1)
})

test('an old removal cannot erase a fresh registration of the same handler', () => {
  const keys = createDispatcher()
  dispatcher = keys
  const node = keys.createNode()
  let calls = 0
  const handler = () => void (calls += 1)
  const removeOld = node.handle('send', handler)
  removeOld()
  node.handle('send', handler)
  removeOld()
  expect(keys.dispatchCommandFrom(node, 'send')).toBe(true)
  expect(calls).toBe(1)
})
