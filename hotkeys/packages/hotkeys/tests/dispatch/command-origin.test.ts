import { afterEach, expect, test } from 'vitest'
import { createBrowserDispatcher, createDispatcher, createKeyInput } from '../../src'
import type { BrowserDispatcher } from '../../src'

let browserDispatcher: BrowserDispatcher | undefined
afterEach(() => {
  browserDispatcher?.dispose()
  browserDispatcher = undefined
  document.body.replaceChildren()
})

test('origin dispatch preserves the focused path and pending chord', () => {
  const calls: string[] = []
  const args = { text: 'hello' }
  const dispatcher = createDispatcher({
    platform: 'linux',
    keymap: [{ keys: 'Control+K Control+C', command: 'comment', context: 'Editor' }],
  })
  const editor = dispatcher.createNode({
    context: 'Editor',
    commands: { comment: () => void calls.push('comment') },
  })
  const workspace = dispatcher.createNode({
    commands: { paste: () => void calls.push('workspace') },
  })
  const origin = dispatcher.createNode({
    parent: workspace,
    context: 'Composer',
    commands: {
      send: (event) => {
        expect(event.node).toBe(origin)
        expect(event.args).toBe(args)
        expect(event.input).toBeNull()
        expect(event.source).toBeNull()
        calls.push('origin')
      },
      paste: () => false,
    },
  })
  editor.focus()
  const press = (key: string) =>
    dispatcher.handleKey(
      createKeyInput({ key, code: `Key${key.toUpperCase()}`, modifiers: { ctrl: true } }),
      null,
    )
  expect(press('k')).toBe(true)
  const pending = dispatcher.pending()
  expect(dispatcher.dispatchCommandFrom(origin, 'send', args)).toBe(true)
  expect(dispatcher.dispatchCommandFrom(origin, 'paste')).toBe(true)
  expect(dispatcher.focused()).toBe(editor)
  expect(dispatcher.pending()).toEqual(pending)
  expect(press('c')).toBe(true)
  expect(calls).toEqual(['origin', 'workspace', 'comment'])
  dispatcher.dispose()
})

test('removed and foreign nodes and disposed dispatchers decline origin commands', () => {
  const calls: string[] = []
  const dispatcher = createDispatcher()
  const foreign = createDispatcher()
  const node = dispatcher.createNode({ commands: { send: () => void calls.push('local') } })
  const outsider = foreign.createNode({ commands: { send: () => void calls.push('foreign') } })
  expect(dispatcher.hasNode(node)).toBe(true)
  expect(dispatcher.hasNode(outsider)).toBe(false)
  expect(dispatcher.dispatchCommandFrom(outsider, 'send')).toBe(false)
  node.remove()
  expect(dispatcher.hasNode(node)).toBe(false)
  expect(dispatcher.dispatchCommandFrom(node, 'send')).toBe(false)
  const live = dispatcher.createNode({ commands: { send: () => void calls.push('disposed') } })
  live.focus()
  dispatcher.dispose()
  expect(dispatcher.hasNode(live)).toBe(false)
  expect(dispatcher.dispatchCommandFrom(live, 'send')).toBe(false)
  expect(dispatcher.dispatchCommand('send')).toBe(false)
  expect(calls).toEqual([])
  foreign.dispose()
})

test('ownership checks reject orphaned paths and leave live readers unsampled', () => {
  const dispatcher = createDispatcher()
  let reads = 0
  const parent = dispatcher.createNode({
    readContext: () => {
      reads += 1
      return 'Parent'
    },
  })
  const child = dispatcher.createNode({
    parent,
    readContext: () => {
      reads += 1
      return 'Child'
    },
  })
  expect(dispatcher.hasNode(child)).toBe(true)
  child.focus()
  expect(dispatcher.focused()).toBe(child)
  parent.remove()
  expect(dispatcher.hasNode(child)).toBe(false)
  child.focus()
  expect(dispatcher.focused()).toBeNull()
  expect(reads).toBe(0)
  dispatcher.dispose()
})

test('origin lookup follows nearest attachments and restores same-element ancestors', () => {
  const shell = document.createElement('div')
  const composer = document.createElement('div')
  const button = document.createElement('button')
  composer.append(button)
  shell.append(composer)
  document.body.append(shell)
  const dispatcher = createBrowserDispatcher({ platform: 'linux' })
  browserDispatcher = dispatcher
  const workspace = dispatcher.createNode()
  const parent = dispatcher.createNode({ parent: workspace })
  const child = dispatcher.createNode({ parent })
  dispatcher.attachElement(workspace, shell)
  const detachChild = dispatcher.attachElement(child, composer)
  const detachParent = dispatcher.attachElement(parent, composer)
  expect(dispatcher.nodeForElement(button)).toBe(child)
  detachChild()
  expect(dispatcher.nodeForElement(button)).toBe(parent)
  detachParent()
  expect(dispatcher.nodeForElement(button)).toBe(workspace)
  expect(dispatcher.nodeForElement(document.createElement('div'))).toBeNull()
  dispatcher.dispose()
  expect(dispatcher.nodeForElement(button)).toBeNull()
})

test('origin lookup crosses a shadow root to its attached host', () => {
  const host = document.createElement('div')
  const inside = document.createElement('button')
  host.attachShadow({ mode: 'open' }).append(inside)
  document.body.append(host)
  const dispatcher = createBrowserDispatcher({ platform: 'linux' })
  browserDispatcher = dispatcher
  const node = dispatcher.createNode()
  dispatcher.attachElement(node, host)
  expect(dispatcher.nodeForElement(inside)).toBe(node)
})
