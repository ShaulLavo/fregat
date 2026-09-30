import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  createEditorBufferSession,
  createEditorTextBuffer,
  createEditorViewSession,
} from '@singapore-editor/core/document'
import { Editor, type EditorCommandId, type EditorOptions } from '@singapore-editor/core/editor'
import { setHighlightRegistry } from '@singapore-editor/core/testing'
import { createEditorFindPlugin } from '../src/plugin'

const editors: Editor[] = []
class TestHighlight extends Set<Range> {}
const highlights = new Map<string, TestHighlight>()

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('Highlight', TestHighlight)
  setHighlightRegistry({
    delete: (name) => highlights.delete(name),
    set: (name, highlight) => {
      if (highlight instanceof TestHighlight) highlights.set(name, highlight)
    },
  })
})

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
  document.body.replaceChildren()
  setHighlightRegistry(undefined)
  highlights.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function mount(options: EditorOptions = {}): Editor {
  const container = document.createElement('div')
  document.body.append(container)
  const editor = new Editor(container, options)
  editor['view'].setScrollMetrics(0, 240, 640)
  editors.push(editor)
  return editor
}

function setInput(editor: Editor, label: string, value: string): void {
  const container: unknown = Reflect.get(editor, 'container')
  expect(container).toBeInstanceOf(HTMLElement)
  if (!(container instanceof HTMLElement)) return
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  expect(input).not.toBeNull()
  if (!input) return
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

test.each([
  { command: 'replaceAll', inSelection: false },
  { command: 'replaceAll', inSelection: true },
  { command: 'replaceOne', inSelection: false },
  { command: 'replaceOne', inSelection: true },
])(
  '$command searches committed text with selection scope $inSelection after a queued edit',
  ({ command, inSelection }) => {
    const buffer = createEditorTextBuffer('foo abc foo')
    const first = mount()
    let reentered = false
    const handled: boolean[] = []
    const second = mount({
      plugins: [createEditorFindPlugin({ seedSearchStringFromSelection: 'never' })],
      onChange: (_state, change) => {
        if (change?.kind !== 'edit' || reentered) return
        reentered = true
        second.edit({ from: 0, to: 0, text: 'PREFIX' })
        handled.push(command === 'replaceAll' ? second.replaceAll() : second.replaceOne())
      },
    })
    first.attachSession(createEditorBufferSession(buffer, createEditorViewSession(buffer, 'first')))
    second.attachSession(
      createEditorBufferSession(buffer, createEditorViewSession(buffer, 'second')),
    )
    second.openFindReplace()
    setInput(second, 'Find', 'foo')
    setInput(second, 'Replace', 'bar')
    if (inSelection) second.dispatchCommand('toggleFindInSelection')

    first.edit({ from: 4, to: 5, text: 'A' })

    expect(handled).toEqual([true])
    const expected =
      command === 'replaceAll' && !inSelection ? 'PREFIXbar Abc bar' : 'PREFIXbar Abc foo'
    expect(buffer.materializeFullText()).toBe(expected)
    expect(second['view'].contentElement.textContent).toBe(expected)
    const paintedMatches = [...highlights].flatMap(([name, ranges]) =>
      name.endsWith('-find-match') ? [...ranges].map((range) => range.toString()) : [],
    )
    expect(paintedMatches).toEqual(command === 'replaceOne' && !inSelection ? ['foo'] : [])
  },
)

test('queued replacement painting preserves a later explicit selection', () => {
  const buffer = createEditorTextBuffer('foo foo abc')
  const first = mount()
  let reentered = false
  const replacementCursors: number[] = []
  const second = mount({
    plugins: [createEditorFindPlugin({ seedSearchStringFromSelection: 'never' })],
    onChange: (_state, change) => {
      if (change?.kind !== 'edit' || reentered) return
      reentered = true
      second.edit({ from: 0, to: 0, text: 'PREFIX' })
      second.replaceOne()
      replacementCursors.push(second.getState().cursor.column)
      second.setSelection(0)
    },
  })
  first.attachSession(createEditorBufferSession(buffer, createEditorViewSession(buffer, 'first')))
  second.attachSession(createEditorBufferSession(buffer, createEditorViewSession(buffer, 'second')))
  second.openFindReplace()
  setInput(second, 'Find', 'foo')
  setInput(second, 'Replace', 'bar')

  first.edit({ from: 8, to: 9, text: 'A' })

  expect(buffer.materializeFullText()).toBe('PREFIXbar foo Abc')
  expect(replacementCursors).toEqual([13])
  expect(second.getState().cursor).toEqual({ row: 0, column: 0 })
})

test.each(['findNext', 'findPrevious', 'selectAllMatches'] satisfies EditorCommandId[])(
  '%s selects committed match ranges before subsequent typing',
  (command) => {
    const buffer = createEditorTextBuffer('foo foo abc')
    const first = mount()
    let reentered = false
    const second = mount({
      plugins: [createEditorFindPlugin({ seedSearchStringFromSelection: 'never' })],
      onChange: (_state, change) => {
        if (change?.kind !== 'edit' || reentered) return
        reentered = true
        second.edit({ from: 0, to: 0, text: 'PREFIX' })
        second.dispatchCommand(command)
        second.getInputElement().dispatchEvent(
          new InputEvent('beforeinput', {
            inputType: 'insertText',
            data: 'X',
            bubbles: true,
            cancelable: true,
          }),
        )
      },
    })
    first.attachSession(createEditorBufferSession(buffer, createEditorViewSession(buffer, 'first')))
    second.attachSession(
      createEditorBufferSession(buffer, createEditorViewSession(buffer, 'second')),
    )
    second.openFind()
    setInput(second, 'Find', 'foo')

    first.edit({ from: 8, to: 9, text: 'A' })

    expect(buffer.materializeFullText()).toBe(
      command === 'selectAllMatches' ? 'PREFIXX X Abc' : 'PREFIXfoo X Abc',
    )
  },
)

test('a scope created after a queued edit contains the current selection', () => {
  const buffer = createEditorTextBuffer('foo foo abc')
  const first = mount()
  let reentered = false
  const second = mount({
    plugins: [createEditorFindPlugin({ seedSearchStringFromSelection: 'never' })],
    onChange: (_state, change) => {
      if (change?.kind !== 'edit' || reentered) return
      reentered = true
      second.edit({ from: 0, to: 0, text: 'fooXXX' })
      second.dispatchCommand('toggleFindInSelection')
      second.replaceAll()
    },
  })
  first.attachSession(createEditorBufferSession(buffer, createEditorViewSession(buffer, 'first')))
  second.attachSession(createEditorBufferSession(buffer, createEditorViewSession(buffer, 'second')))
  second.openFindReplace()
  setInput(second, 'Find', 'foo')
  setInput(second, 'Replace', 'bar')

  first.edit({ from: 8, to: 9, text: 'A' })

  expect(buffer.materializeFullText()).toBe('fooXXXbar foo Abc')
})

test('opening find seeds and scopes the committed selection after a queued edit', () => {
  const buffer = createEditorTextBuffer('foo foo abc')
  const first = mount()
  let reentered = false
  const second = mount({
    plugins: [
      createEditorFindPlugin({
        seedSearchStringFromSelection: 'selection',
        autoFindInSelection: 'always',
      }),
    ],
    onChange: (_state, change) => {
      if (change?.kind !== 'edit' || reentered) return
      reentered = true
      second.edit({ from: 0, to: 0, text: 'BARXXX' })
      second.openFindReplace()
      setInput(second, 'Replace', 'bar')
      second.replaceAll()
    },
  })
  first.attachSession(createEditorBufferSession(buffer, createEditorViewSession(buffer, 'first')))
  second.attachSession(createEditorBufferSession(buffer, createEditorViewSession(buffer, 'second')))
  second.setSelection(0, 3)

  first.edit({ from: 8, to: 9, text: 'A' })

  expect(buffer.materializeFullText()).toBe('BARXXXbar foo Abc')
})

test('a selection listener edit carries the current match onto the committed text', () => {
  let armed = false
  let reentered = false
  const editor = mount({
    defaultText: 'foo foo abc',
    plugins: [createEditorFindPlugin({ seedSearchStringFromSelection: 'never' })],
    onChange: (_state, change) => {
      if (!armed || change?.kind !== 'selection' || reentered) return
      reentered = true
      editor.edit({ from: 0, to: 0, text: 'PREFIX' })
    },
  })
  editor.openFind()
  setInput(editor, 'Find', 'foo')
  armed = true

  editor.findNext()

  const currentMatches = [...highlights].flatMap(([name, ranges]) =>
    name.endsWith('-find-current') ? [...ranges].map((range) => range.toString()) : [],
  )
  expect(editor.materializeFullText()).toBe('PREFIXfoo foo abc')
  expect(currentMatches).toEqual(['foo'])
})
