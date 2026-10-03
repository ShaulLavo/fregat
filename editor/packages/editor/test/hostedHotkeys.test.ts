import { createBrowserDispatcher, type BrowserDispatcher } from '@fregat/hotkeys'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Editor } from '../src/editor/Editor'
import { baseEditorKeymap, markdownPack } from '../src/keymap/presets'
import { createPlugin } from '../src/createPlugin'
import { setHighlightRegistry } from '../src/public/testing'
import { createVisibleEditor } from './factories/visibleEditor'

const editors: Editor[] = []
const dispatchers: BrowserDispatcher[] = []
beforeEach(() => {
  vi.stubGlobal('Highlight', class extends Set<Range> {})
  setHighlightRegistry(new Map())
})
afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
  for (const dispatcher of dispatchers.splice(0)) dispatcher.dispose()
  document.body.replaceChildren()
  setHighlightRegistry(undefined)
  vi.unstubAllGlobals()
})
function create(options: ConstructorParameters<typeof Editor>[1] = {}) {
  const container = document.createElement('div')
  document.body.append(container)
  const editor = createVisibleEditor(container, options)
  editors.push(editor)
  editor.setText('alpha beta', { languageId: 'markdown' })
  editor.setSelection(0, 0)
  editor.focus()
  return editor
}
function press(editor: Editor, key: string, ctrlKey = false) {
  const event = new KeyboardEvent('keydown', { key, ctrlKey, bubbles: true, cancelable: true })
  editor.getInputElement().dispatchEvent(event)
  return event
}
function boldPlugin(run: () => boolean) {
  return createPlugin({
    name: 'test.bold',
    view(scope) {
      scope.own(scope.view.registerKeymapContextKey('markdown', () => true))
      scope.handle('markdown.bold', run)
    },
  })
}
test('Markdown shortcuts are opt-in on the simple text path and setKeymap updates them', () => {
  const bold = vi.fn(() => true)
  const editor = create({ plugins: [boldPlugin(bold)] })
  expect(press(editor, 'b', true).defaultPrevented).toBe(false)
  expect(bold).not.toHaveBeenCalled()
  editor.setKeymap({ packs: [markdownPack] })
  expect(press(editor, 'b', true).defaultPrevented).toBe(true)
  expect(bold).toHaveBeenCalledOnce()
})
test('hosted editor contributes live context and commands without installing bindings', () => {
  const dispatcher = createBrowserDispatcher({
    root: document,
    platform: 'linux',
    keymap: [
      { keys: 'Control+B', command: 'sidebar', context: 'Workspace', source: 'default' },
      {
        keys: 'Control+L',
        command: 'selectAll',
        context: 'Editor && extension == md',
        source: 'user',
      },
    ],
  })
  dispatchers.push(dispatcher)
  const sidebar = vi.fn(() => true)
  const parent = dispatcher.createNode({ context: 'Workspace', commands: { sidebar } })
  dispatcher.attachElement(parent, document.body)
  const keymap = vi.spyOn(dispatcher, 'setKeymap')
  const editor = create({
    hotkeys: dispatcher,
    hotkeysParent: parent,
    keymapContext: { extension: 'md' },
  })
  expect(keymap).not.toHaveBeenCalled()
  expect(editor.getHotkeysHost().node.parent).toBe(parent)
  expect(press(editor, 'b', true).defaultPrevented).toBe(true)
  expect(sidebar).toHaveBeenCalledOnce()
  expect(press(editor, 'l', true).defaultPrevented).toBe(true)
  expect(editor.getKeymapContext().hasSelection).toBe(true)
  editor.setKeymap({ packs: [markdownPack] })
  expect(keymap).not.toHaveBeenCalled()
  editor.dispose()
  expect(dispatcher.focused()).toBe(parent)
})
test('read-only refusal protects direct and hosted commands', () => {
  const bold = vi.fn(() => true)
  const dispatcher = createBrowserDispatcher({
    root: document,
    platform: 'linux',
    keymap: markdownPack.linux,
  })
  dispatchers.push(dispatcher)
  const editor = create({
    hotkeys: dispatcher,
    editability: 'readonly',
    plugins: [boldPlugin(bold)],
  })
  expect(editor.dispatchCommand('markdown.bold')).toBe(false)
  expect(press(editor, 'b', true).defaultPrevented).toBe(false)
  expect(bold).not.toHaveBeenCalled()
})
test('widget child nodes retain app shortcuts and leave field navigation local', () => {
  const dispatcher = createBrowserDispatcher({
    root: document,
    platform: 'linux',
    keymap: [
      ...baseEditorKeymap.linux,
      { keys: 'Control+B', command: 'sidebar', context: 'Workspace', source: 'default' },
    ],
  })
  dispatchers.push(dispatcher)
  const sidebar = vi.fn(() => true)
  const parent = dispatcher.createNode({ context: 'Workspace', commands: { sidebar } })
  const editor = create({ hotkeys: dispatcher, hotkeysParent: parent })
  const widget = document.createElement('input')
  document.body.append(widget)
  const close = vi.fn(() => true)
  const registration = editor.registerKeymapNode({
    element: widget,
    context: 'EditorWidget FindWidget',
    commands: { closeFind: close },
  })
  widget.focus()
  const key = (key: string, ctrlKey = false) => {
    const event = new KeyboardEvent('keydown', { key, ctrlKey, bubbles: true, cancelable: true })
    widget.dispatchEvent(event)
    return event
  }
  expect(key('ArrowLeft').defaultPrevented).toBe(false)
  expect(key('b', true).defaultPrevented).toBe(true)
  expect(sidebar).toHaveBeenCalledOnce()
  expect(key('Escape').defaultPrevented).toBe(true)
  expect(close).toHaveBeenCalledOnce()
  registration.dispose()
})

test('widget commands share the readonly mutation gate', () => {
  const editor = create({ editability: 'readonly' })
  const widget = document.createElement('input')
  document.body.append(widget)
  const accept = vi.fn(() => true)
  const cancel = vi.fn(() => true)
  const registration = editor.registerKeymapNode({
    element: widget,
    context: 'EditorWidget RenameWidget',
    commands: {
      'lsp.rename.accept': accept,
      'lsp.rename.cancel': cancel,
    },
  })
  widget.focus()
  widget.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  )
  expect(accept).not.toHaveBeenCalled()
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  widget.dispatchEvent(escape)
  expect(cancel).toHaveBeenCalledOnce()
  expect(escape.defaultPrevented).toBe(true)
  registration.dispose()
})
