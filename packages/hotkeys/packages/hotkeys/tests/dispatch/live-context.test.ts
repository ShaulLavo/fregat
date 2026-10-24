import { afterEach, expect, it, vi } from 'vitest'
import { createBrowserDispatcher, createDispatcher, createKeyInput } from '../../src'
import type { BrowserDispatcher } from '../../src'

let browserDispatcher: BrowserDispatcher | undefined

afterEach(() => {
  vi.useRealTimers()
  browserDispatcher?.dispose()
  browserDispatcher = undefined
  document.body.replaceChildren()
})

function press(key: string) {
  return createKeyInput({
    key,
    code: `Key${key.toUpperCase()}`,
    modifiers: { ctrl: true },
  })
}

it('reads each captured node once and selects the current predicate between strokes', () => {
  let canBold = false
  const calls: string[] = []
  const readWorkspace = vi.fn(() => 'Workspace')
  const readEditor = vi.fn(() => ({ identifiers: canBold ? ['Editor', 'canBold'] : ['Editor'] }))
  const dispatcher = createDispatcher({
    platform: 'linux',
    keymap: [
      { keys: 'Control+B', command: 'sidebar', context: 'Workspace' },
      { keys: 'Control+B', command: 'bold', context: 'Editor && canBold' },
    ],
  })
  const workspace = dispatcher.createNode({
    context: 'Workspace',
    readContext: readWorkspace,
    commands: { sidebar: () => void calls.push('sidebar') },
  })
  const editor = dispatcher.createNode({
    parent: workspace,
    context: 'Editor',
    readContext: readEditor,
    commands: { bold: () => void calls.push('bold') },
  })
  editor.focus()
  expect(readWorkspace).not.toHaveBeenCalled()
  expect(readEditor).not.toHaveBeenCalled()

  expect(dispatcher.handleKey(press('b'), null)).toBe(true)
  canBold = true
  expect(dispatcher.handleKey(press('b'), null)).toBe(true)

  expect(calls).toEqual(['sidebar', 'bold'])
  expect(readWorkspace).toHaveBeenCalledTimes(2)
  expect(readEditor).toHaveBeenCalledTimes(2)
  expect(editor.context().identifiers).toEqual(new Set(['Editor', 'canBold']))
  expect(readEditor).toHaveBeenCalledTimes(3)
  dispatcher.dispose()
})

it('refreshes predicates when a pending chord continues', () => {
  let canComment = true
  const calls: string[] = []
  const readContext = vi.fn(() => ({
    identifiers: canComment ? ['Editor', 'canComment'] : ['Editor'],
  }))
  const dispatcher = createDispatcher({
    platform: 'linux',
    keymap: [
      { keys: 'Control+K Control+C', command: 'comment', context: 'Editor && canComment' },
      { keys: 'Control+K Control+C', command: 'fallback', context: 'Editor && !canComment' },
    ],
  })
  dispatcher
    .createNode({
      context: 'Editor canComment',
      readContext,
      commands: {
        comment: () => void calls.push('comment'),
        fallback: () => void calls.push('fallback'),
      },
    })
    .focus()

  expect(dispatcher.handleKey(press('k'), null)).toBe(true)
  expect(dispatcher.pending()).toEqual({ keys: 'Mod+K', candidateCount: 1 })
  canComment = false
  expect(dispatcher.handleKey(press('c'), null)).toBe(true)

  expect(calls).toEqual(['fallback'])
  expect(readContext).toHaveBeenCalledTimes(2)
  expect(dispatcher.pending()).toBeNull()
  dispatcher.dispose()
})

it('keeps static setContext updates', () => {
  const calls: string[] = []
  const dispatcher = createDispatcher({
    platform: 'linux',
    keymap: [{ keys: 'Control+B', command: 'bold', context: 'Editor && canBold' }],
  })
  const editor = dispatcher.createNode({
    context: 'Editor',
    commands: { bold: () => void calls.push('bold') },
  })
  editor.focus()

  expect(dispatcher.handleKey(press('b'), null)).toBe(false)
  editor.setContext('Editor canBold')
  expect(editor.context().identifiers).toEqual(new Set(['Editor', 'canBold']))
  expect(dispatcher.handleKey(press('b'), null)).toBe(true)
  expect(calls).toEqual(['bold'])
  dispatcher.dispose()
})

it('drops a pending chord when focus moves between nodes with live context', () => {
  const calls: string[] = []
  const dispatcher = createDispatcher({
    platform: 'linux',
    keymap: [{ keys: 'Control+K Control+C', command: 'comment', context: 'Editor' }],
  })
  const first = dispatcher.createNode({
    context: 'Editor',
    readContext: () => 'Editor',
    commands: { comment: () => void calls.push('first') },
  })
  const second = dispatcher.createNode({
    context: 'Editor',
    readContext: () => 'Editor',
    commands: { comment: () => void calls.push('second') },
  })
  first.focus()
  expect(dispatcher.handleKey(press('k'), null)).toBe(true)

  second.focus()
  expect(dispatcher.handleKey(press('c'), null)).toBe(false)
  expect(calls).toEqual([])
  expect(dispatcher.pending()).toBeNull()
  dispatcher.dispose()
})

it('uses live context when an ambiguous prefix times out', () => {
  vi.useFakeTimers()
  let mode = 'edit'
  const calls: string[] = []
  const dispatcher = createDispatcher({
    platform: 'linux',
    keymap: [
      { keys: 'Control+K', command: 'edit', context: 'mode == edit' },
      { keys: 'Control+K', command: 'browse', context: 'mode == browse' },
      { keys: 'Control+K Control+C', command: 'comment' },
    ],
  })
  dispatcher
    .createNode({
      context: 'mode=edit',
      readContext: () => ({ values: { mode } }),
      commands: {
        edit: () => void calls.push('edit'),
        browse: () => void calls.push('browse'),
      },
    })
    .focus()

  expect(dispatcher.handleKey(press('k'), null)).toBe(true)
  mode = 'browse'
  vi.advanceTimersByTime(1000)

  expect(calls).toEqual(['browse'])
  expect(dispatcher.pending()).toBeNull()
  dispatcher.dispose()
})

it('the reader overrides conflicting static context and setContext in every capture path', () => {
  const calls: string[] = []
  const dispatcher = createDispatcher({
    platform: 'linux',
    keymap: [
      { keys: 'Control+B', command: 'static', context: 'Editor && static' },
      { keys: 'Control+B', command: 'live', context: 'Editor && live && mode == live' },
    ],
  })
  const node = dispatcher.createNode({
    context: 'Editor static mode=static',
    readContext: () => ({ identifiers: ['Editor', 'live'], values: { mode: 'live' } }),
    commands: {
      static: () => void calls.push('static'),
      live: () => void calls.push('live'),
    },
  })
  node.focus()
  expect(node.context().identifiers).toEqual(new Set(['Editor', 'live']))
  expect(node.context().values).toEqual(new Map([['mode', 'live']]))
  expect(dispatcher.contextStack().map((context) => Array.from(context.identifiers))).toEqual([
    ['Editor', 'live'],
  ])
  expect(dispatcher.handleKey(press('b'), null)).toBe(true)
  node.setContext('Editor static mode=static')
  expect(node.context().identifiers).toEqual(new Set(['Editor', 'live']))
  expect(dispatcher.contextStack().map((context) => Array.from(context.values))).toEqual([
    [['mode', 'live']],
  ])
  expect(dispatcher.handleKey(press('b'), null)).toBe(true)
  expect(calls).toEqual(['live', 'live'])
  dispatcher.dispose()
})

it('forwarded browser events use live state with one sample per captured node', () => {
  const input = document.createElement('textarea')
  document.body.append(input)
  let canBold = false
  const calls: string[] = []
  const readWorkspace = vi.fn(() => 'Workspace')
  const readEditor = vi.fn(() => ({ identifiers: canBold ? ['Editor', 'canBold'] : ['Editor'] }))
  const dispatcher = createBrowserDispatcher({
    platform: 'linux',
    keymap: [
      { keys: 'Control+B', command: 'sidebar', context: 'Workspace' },
      { keys: 'Control+B', command: 'bold', context: 'Editor && canBold' },
    ],
  })
  browserDispatcher = dispatcher
  const workspace = dispatcher.createNode({
    context: 'Workspace',
    readContext: readWorkspace,
    commands: { sidebar: () => void calls.push('sidebar') },
  })
  const editor = dispatcher.createNode({
    parent: workspace,
    context: 'Editor',
    readContext: readEditor,
    commands: { bold: () => void calls.push('bold') },
  })
  dispatcher.attachElement(workspace, document.body)
  dispatcher.attachElement(editor, input)
  input.addEventListener('keydown', (event) => {
    expect(dispatcher.claimKeybinding(event)).toBe(true)
    expect(dispatcher.claimKeybinding(event)).toBe(true)
  })
  for (const available of [false, true]) {
    canBold = available
    const event = new KeyboardEvent('keydown', {
      key: 'b',
      code: 'KeyB',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      composed: true,
    })
    input.dispatchEvent(event)
    expect(dispatcher.claimKeybinding(event)).toBe(true)
  }
  expect(calls).toEqual(['sidebar', 'bold'])
  expect(readWorkspace).toHaveBeenCalledTimes(2)
  expect(readEditor).toHaveBeenCalledTimes(2)
})
