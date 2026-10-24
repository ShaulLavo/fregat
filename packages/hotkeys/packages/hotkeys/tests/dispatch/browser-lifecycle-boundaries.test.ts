import { afterEach, expect, test } from 'vitest'
import { createBrowserDispatcher } from '../../src'
import type { BrowserDispatcher, BrowserKeyObserver } from '../../src'

let dispatcher: BrowserDispatcher | undefined
afterEach(() => {
  dispatcher?.dispose()
  dispatcher = undefined
  document.body.replaceChildren()
})

function key(target: Element) {
  const event = new KeyboardEvent('keydown', {
    key: 'b',
    code: 'KeyB',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    composed: true,
  })
  target.dispatchEvent(event)
  return event
}

test.each(['parent-first', 'child-first'] as const)(
  'core removal restores a same-element live parent after %s attachment',
  (order) => {
    const input = document.createElement('textarea')
    const elsewhere = document.createElement('textarea')
    document.body.append(input, elsewhere)
    const calls: string[] = []
    dispatcher = createBrowserDispatcher({
      platform: 'linux',
      keymap: [{ keys: 'Control+B', command: 'toggle' }],
    })
    const parent = dispatcher.createNode({ commands: { toggle: () => void calls.push('parent') } })
    const child = dispatcher.createNode({
      parent,
      commands: { toggle: () => void calls.push('child') },
    })
    const other = dispatcher.createNode({ commands: { toggle: () => void calls.push('other') } })
    for (const node of order === 'parent-first' ? [parent, child] : [child, parent])
      dispatcher.attachElement(node, input)
    dispatcher.attachElement(other, elsewhere)
    key(elsewhere)
    child.remove()
    expect(key(input).defaultPrevented).toBe(true)
    expect(dispatcher.focused()).toBe(parent)
    expect(dispatcher.nodeForElement(input)).toBe(parent)
    expect(dispatcher.dispatchCommandFrom(dispatcher.nodeForElement(input)!, 'toggle')).toBe(true)
    expect(calls).toEqual(['other', 'parent', 'parent'])
  },
)

test('core removal restores a live DOM ancestor for keys and command origins', () => {
  const shell = document.createElement('div')
  const input = document.createElement('textarea')
  const elsewhere = document.createElement('textarea')
  shell.append(input)
  document.body.append(shell, elsewhere)
  const calls: string[] = []
  dispatcher = createBrowserDispatcher({
    platform: 'linux',
    keymap: [{ keys: 'Control+B', command: 'toggle' }],
  })
  const parent = dispatcher.createNode({ commands: { toggle: () => void calls.push('parent') } })
  const child = dispatcher.createNode({
    parent,
    commands: { toggle: () => void calls.push('child') },
  })
  const other = dispatcher.createNode({ commands: { toggle: () => void calls.push('other') } })
  dispatcher.attachElement(parent, shell)
  dispatcher.attachElement(child, input)
  dispatcher.attachElement(other, elsewhere)
  key(elsewhere)
  child.remove()
  expect(key(input).defaultPrevented).toBe(true)
  expect(dispatcher.focused()).toBe(parent)
  expect(dispatcher.nodeForElement(input)).toBe(parent)
  expect(dispatcher.dispatchCommandFrom(dispatcher.nodeForElement(input)!, 'toggle')).toBe(true)
  expect(calls).toEqual(['other', 'parent', 'parent'])
})

test('a removed attachment clears event focus while explicit detach-all preserves manual focus', () => {
  const input = document.createElement('textarea')
  const elsewhere = document.createElement('textarea')
  document.body.append(input, elsewhere)
  const calls: string[] = []
  dispatcher = createBrowserDispatcher({
    platform: 'linux',
    keymap: [{ keys: 'Control+B', command: 'toggle' }],
  })
  const removed = dispatcher.createNode({ commands: { toggle: () => void calls.push('removed') } })
  const other = dispatcher.createNode({ commands: { toggle: () => void calls.push('other') } })
  const detachRemoved = dispatcher.attachElement(removed, input)
  const detachOther = dispatcher.attachElement(other, elsewhere)
  key(elsewhere)
  removed.remove()
  expect(key(input).defaultPrevented).toBe(false)
  expect(dispatcher.focused()).toBeNull()
  expect(dispatcher.nodeForElement(input)).toBeNull()
  expect(calls).toEqual(['other'])
  detachRemoved()
  detachOther()
  other.focus()
  expect(key(input).defaultPrevented).toBe(true)
  expect(dispatcher.focused()).toBe(other)
  expect(calls).toEqual(['other', 'other'])
})

test.each(['beforeKey', 'reset'] as const)(
  'self-resubscription during %s begins with the next notification',
  (kind) => {
    const input = document.createElement('textarea')
    document.body.append(input)
    dispatcher = createBrowserDispatcher({ platform: 'linux' })
    let calls = 0
    let unsubscribe = () => {}
    const notify = () => {
      calls += 1
      // Bound the baseline's live-Set loop so a negative control cannot hang the suite.
      if (calls > 2) return
      unsubscribe()
      unsubscribe = dispatcher!.observeKeys(observer)
    }
    const observer: BrowserKeyObserver = {
      beforeKey: kind === 'beforeKey' ? notify : () => {},
      reset: kind === 'reset' ? notify : () => {},
    }
    unsubscribe = dispatcher.observeKeys(observer)
    const trigger = () => {
      if (kind === 'beforeKey') key(input)
      else dispatcher!.releaseAll()
    }
    trigger()
    expect(calls).toBe(1)
    trigger()
    expect(calls).toBe(2)
    unsubscribe()
  },
)

test.each(['beforeKey', 'reset'] as const)(
  'subscriber addition and removal during %s uses a stable registration snapshot',
  (kind) => {
    const input = document.createElement('textarea')
    document.body.append(input)
    dispatcher = createBrowserDispatcher({ platform: 'linux' })
    const calls: string[] = []
    let first = true
    let removeSecond = () => {}
    const second: BrowserKeyObserver = {
      beforeKey: () => {
        if (kind === 'beforeKey') calls.push('second')
      },
      reset: () => {
        if (kind === 'reset') calls.push('second')
      },
    }
    const notify = () => {
      calls.push('first')
      if (!first) return
      first = false
      removeSecond()
      removeSecond = dispatcher!.observeKeys(second)
    }
    const removeFirst = dispatcher.observeKeys({
      beforeKey: kind === 'beforeKey' ? notify : () => {},
      reset: kind === 'reset' ? notify : () => {},
    })
    removeSecond = dispatcher.observeKeys(second)
    const trigger = () => {
      if (kind === 'beforeKey') key(input)
      else dispatcher!.releaseAll()
    }
    trigger()
    expect(calls).toEqual(['first'])
    trigger()
    expect(calls).toEqual(['first', 'first', 'second'])
    removeFirst()
    removeSecond()
  },
)
