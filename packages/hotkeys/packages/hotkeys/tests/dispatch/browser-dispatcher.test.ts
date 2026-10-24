import { afterEach, expect, test } from 'vitest'
import { createBrowserDispatcher } from '../../src'
import type { BrowserDispatcher } from '../../src'

let dispatcher: BrowserDispatcher | undefined
afterEach(() => {
  dispatcher?.dispose()
  dispatcher = undefined
  document.body.replaceChildren()
})
function keydown(target: Element, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    code: `Key${key.toUpperCase()}`,
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  })
  target.dispatchEvent(event)
  return event
}

test('the focus path follows DOM containment of attached elements', () => {
  const calls: string[] = []
  const shell = document.createElement('div')
  const editorHost = document.createElement('div')
  const input = document.createElement('textarea')
  editorHost.append(input)
  shell.append(editorHost)
  document.body.append(shell)
  dispatcher = createBrowserDispatcher({
    platform: 'linux',
    keymap: [
      { keys: 'Control+B', command: 'sidebar.toggle', context: 'Workspace' },
      { keys: 'Control+B', command: 'markdown.bold', context: 'Editor' },
    ],
  })
  const workspace = dispatcher.createNode({
    context: 'Workspace',
    commands: { 'sidebar.toggle': () => void calls.push('sidebar') },
  })
  const editor = dispatcher.createNode({
    parent: workspace,
    context: 'Editor',
    commands: { 'markdown.bold': () => void calls.push('bold') },
  })
  dispatcher.attachElement(workspace, shell)
  dispatcher.attachElement(editor, editorHost)

  const inEditor = keydown(input, 'b', { ctrlKey: true })
  expect(inEditor.defaultPrevented).toBe(true)
  const inShell = keydown(shell, 'b', { ctrlKey: true })
  expect(inShell.defaultPrevented).toBe(true)
  expect(calls).toEqual(['bold', 'sidebar'])
  const typed = keydown(input, 'x')
  expect(typed.defaultPrevented).toBe(false)
})

test.each(['parent-first', 'child-first'] as const)(
  'the deepest node survives same-element attachment order %s',
  (order) => {
    const input = document.createElement('textarea')
    document.body.append(input)
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
    const attachments = order === 'parent-first' ? [parent, child] : [child, parent]
    const removals = new Map(
      attachments.map((node) => [node, dispatcher!.attachElement(node, input)]),
    )
    keydown(input, 'b', { ctrlKey: true })
    removals.get(child)!()
    keydown(input, 'b', { ctrlKey: true })
    removals.get(parent)!()
    expect(calls).toEqual(['child', 'parent'])
  },
)

test('later equal-depth ties restore earlier registrations when detached', () => {
  const input = document.createElement('textarea')
  document.body.append(input)
  const calls: string[] = []
  dispatcher = createBrowserDispatcher({
    platform: 'linux',
    keymap: [{ keys: 'Control+B', command: 'toggle' }],
  })
  const first = dispatcher.createNode({ commands: { toggle: () => void calls.push('first') } })
  const second = dispatcher.createNode({ commands: { toggle: () => void calls.push('second') } })
  const detachFirst = dispatcher.attachElement(first, input)
  const detachSecond = dispatcher.attachElement(second, input)
  keydown(input, 'b', { ctrlKey: true })
  detachSecond()
  detachSecond()
  keydown(input, 'b', { ctrlKey: true })
  detachFirst()
  dispatcher.attachElement(second, input)
  detachFirst()
  keydown(input, 'b', { ctrlKey: true })
  expect(calls).toEqual(['second', 'first', 'second'])
})
