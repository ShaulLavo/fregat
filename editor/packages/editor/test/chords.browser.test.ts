import { afterEach, expect, test } from 'vitest'
import { commands } from 'vitest/browser'
import { Editor } from '../src/editor/Editor'
import type { EditorKeymapOptions } from '../src/editor/keymap'
import { createEditorFindPlugin } from '../../find/src/plugin'
import '../src/style.css'

declare module 'vitest/browser' {
  interface BrowserCommands {
    proofKeyPress: (key: string) => Promise<void>
    proofKeyDown: (key: string) => Promise<void>
    proofKeyUp: (key: string) => Promise<void>
  }
}
const editors: Editor[] = []
const elements: HTMLElement[] = []
afterEach(async () => {
  for (const key of ['k', 'c', 'x', 'Control']) await commands.proofKeyUp(key)
  for (const editor of editors.splice(0)) editor.dispose()
  for (const element of elements.splice(0)) element.remove()
})
function create(keymap?: EditorKeymapOptions, readOnly = false, find = false) {
  const container = document.createElement('div')
  container.style.cssText = 'width:600px;height:160px'
  document.body.append(container)
  elements.push(container)
  const editor = new Editor(container, {
    keymap,
    plugins: find ? [createEditorFindPlugin()] : [],
    editability: readOnly ? 'readonly' : 'editable',
  })
  editors.push(editor)
  editor.openDocument({ documentId: 'test.txt', text: 'alpha beta' })
  editor.setSelection(0, 0)
  editor.focus()
  return editor
}
const custom: EditorKeymapOptions = {
  defaultBindings: false,
  layers: [
    { id: 'custom', bindings: [{ chord: ['Control+K', 'Control+C'], command: 'selectAll' }] },
  ],
}
async function press(key: string) {
  await commands.proofKeyPress(key)
}

test('ordinary options execute once with trusted input and no inserted strokes', async () => {
  const editor = create(custom)
  let executions = 0
  const dispatch = editor.dispatchCommand.bind(editor)
  editor.dispatchCommand = (command, context) => {
    executions += 1
    return dispatch(command, context)
  }
  let trusted = false
  editor.getInputElement().addEventListener(
    'keydown',
    (event) => {
      trusted = event.isTrusted
    },
    { once: true },
  )
  await press('Control+k')
  expect(executions).toBe(0)
  await press('Control+c')
  expect(trusted).toBe(true)
  expect(executions).toBe(1)
  expect(editor.getKeymapContext().hasSelection).toBe(true)
  expect(editor.materializeFullText()).toBe('alpha beta')
})

test('held prefix, completion, and mismatch remain owned until release', async () => {
  const editor = create(custom)
  await commands.proofKeyDown('Control')
  await commands.proofKeyDown('k')
  await commands.proofKeyDown('k')
  await commands.proofKeyDown('c')
  editor.setSelection(0, 0)
  await commands.proofKeyDown('c')
  expect(editor.getKeymapContext().hasSelection).toBe(false)
  await commands.proofKeyUp('Control')
  await commands.proofKeyDown('k')
  await commands.proofKeyDown('c')
  expect(editor.materializeFullText()).toBe('alpha beta')
  await commands.proofKeyUp('k')
  await commands.proofKeyUp('c')
  await press('Control+k')
  await commands.proofKeyDown('x')
  await commands.proofKeyDown('x')
  expect(editor.materializeFullText()).toBe('alpha beta')
})

test('disable retains held ownership; re-enable installs one matcher', async () => {
  const editor = create(custom)
  await commands.proofKeyDown('Control')
  await commands.proofKeyDown('k')
  editor.setKeymap({ ...custom, enabled: false })
  await commands.proofKeyUp('Control')
  await commands.proofKeyDown('k')
  expect(editor.materializeFullText()).toBe('alpha beta')
  await commands.proofKeyUp('k')
  await press('x')
  expect(editor.materializeFullText()).toBe('xalpha beta')
  editor.setKeymap(custom)
  await press('Control+k')
  await press('Control+c')
  expect(editor.getKeymapContext().hasSelection).toBe(true)
})

test('focus changes and pointer cancellation cannot complete another editor sequence', async () => {
  const first = create(custom)
  const second = create(custom)
  first.focus()
  await press('Control+k')
  second.focus()
  await press('Control+c')
  expect(first.getKeymapContext().hasSelection).toBe(false)
  expect(second.getKeymapContext().hasSelection).toBe(false)
  first.focus()
  await press('Control+c')
  expect(first.getKeymapContext().hasSelection).toBe(false)
  await press('Control+k')
  first.getInputElement().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  await press('Control+c')
  expect(first.getKeymapContext().hasSelection).toBe(false)
})

test('binding replacement cancels pending and disposal removes listeners', async () => {
  const editor = create(custom)
  await press('Control+k')
  editor.setKeymap({
    defaultBindings: false,
    layers: [
      {
        id: 'replacement',
        bindings: [{ chord: ['Control+K', 'Control+D'], command: 'selectAll' }],
      },
    ],
  })
  await press('Control+c')
  expect(editor.getKeymapContext().hasSelection).toBe(false)
  await press('Control+k')
  await press('Control+d')
  expect(editor.getKeymapContext().hasSelection).toBe(true)
  editor.dispose()
  editors.splice(editors.indexOf(editor), 1)
  const input = document.createElement('input')
  elements.push(input)
  document.body.append(input)
  input.focus()
  await press('x')
  expect(input.value).toBe('x')
})

test('real timeout does not release a held prefix into text', async () => {
  const editor = create(custom)
  await commands.proofKeyDown('Control')
  await commands.proofKeyDown('k')
  await new Promise((resolve) => setTimeout(resolve, 5100))
  await commands.proofKeyUp('Control')
  await commands.proofKeyDown('k')
  await commands.proofKeyUp('k')
  await press('Control+c')
  expect(editor.getKeymapContext().hasSelection).toBe(false)
  expect(editor.materializeFullText()).toBe('alpha beta')
}, 10000)

test('Tab moves real focus and read-only navigation survives', async () => {
  const editor = create()
  const next = document.createElement('button')
  next.textContent = 'Next'
  elements.push(next)
  document.body.append(next)
  editor.setTabMovesFocus(true)
  await press('Tab')
  expect(document.activeElement).toBe(next)
  const reader = create(undefined, true)
  await press('ArrowRight')
  await press('Backspace')
  expect(reader.materializeFullText()).toBe('alpha beta')
  expect(reader.getKeymapContext().writable).toBe(false)
})

test('default fold chord hides real document rows', async () => {
  const editor = create()
  editor.setText('first\nsecond\nthird\nfourth')
  editor.setSelection(0, 18)
  expect(editor.dispatchCommand('editor.createFoldingRangeFromSelection')).toBe(true)
  editor.unfoldAll()
  const before = editor.getInputElement().parentElement?.textContent
  await press('Control+k')
  await press('Control+0')
  const after = editor.getInputElement().parentElement?.textContent
  expect(after).not.toBe(before)
  expect(after).not.toContain('second')
})

test('local find input handles trusted editing and Escape before idle editor shortcuts', async () => {
  const editor = create(undefined, false, true)
  await press('Control+f')
  expect(editor.getKeymapContext().findVisible).toBe(true)
  const input = document.activeElement
  expect(input).toBeInstanceOf(HTMLInputElement)
  await press('a')
  await press('b')
  await press('Backspace')
  expect((input as HTMLInputElement).value).toBe('a')
  expect(editor.materializeFullText()).toBe('alpha beta')
  await press('Escape')
  expect(editor.getKeymapContext().findVisible).toBe(false)
})

test('disabled shortcuts preserve trusted native cut and paste', async () => {
  const editor = create({ enabled: false })
  editor.setSelection(0, 5)
  await press('Control+x')
  await expect.poll(() => editor.materializeFullText()).toBe(' beta')
  await press('Control+v')
  await expect.poll(() => editor.materializeFullText()).toBe('alpha beta')
})
