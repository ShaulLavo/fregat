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
