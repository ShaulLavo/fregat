import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Editor } from '../src/editor/Editor'
import type { EditorOptions } from '../src/editor/types'
import type { InlineReplacementSpec } from '../src/inlineMap'
import type { EditorInlineReplacementContext, EditorPlugin } from '../src/plugins'
import { resetEditorInstanceCount, setHighlightRegistry } from '../src/public/testing'
import { VirtualizedTextView } from '../src/virtualization'
import { createVisibleEditor } from './factories/visibleEditor'

/**
 * A chip over plain text, the way a chat composer holds a mention: the buffer keeps `@path`, and a
 * replacement derived from the text on every edit paints it whole. Everything goes through the
 * one-line path, `new Editor(element)` and `setText`, since no document should be needed for it.
 */

const MENTION = /@[\w./-]+/g
const TEXT = 'see @src/foo.ts now'
const CHIP_START = 4
const CHIP_END = 15

class MockHighlight extends Set<AbstractRange> {}

const mockRegistry = { delete: () => true, set: () => undefined }

type Chips = {
  renders: number
  disposals: number
  readonly contexts: EditorInlineReplacementContext[]
}

let container: HTMLElement
let editor: Editor

beforeEach(() => {
  // @ts-expect-error happy-dom has no Highlight constructor
  globalThis.Highlight = MockHighlight
  setHighlightRegistry(mockRegistry)
  resetEditorInstanceCount()
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  editor.dispose()
  container.remove()
  setHighlightRegistry(undefined)
})

function mount(text: string, options: EditorOptions = {}): Chips {
  editor = createVisibleEditor(container, { rtlMoveVisually: false, ...options })
  editor.setText(text)
  const chips: Chips = { renders: 0, disposals: 0, contexts: [] }
  editor.setInlineReplacementProvider((context) => mentionSpecs(chips, context), {
    trigger: 'edit',
  })
  return chips
}

/** Ids follow the offset, as a provider deriving them from the text has to; keys follow the path. */
function mentionSpecs(
  chips: Chips,
  context: EditorInlineReplacementContext,
): readonly InlineReplacementSpec[] {
  chips.contexts.push(context)
  const text = context.textSnapshot.readRange(0, context.textSnapshot.length)
  return [...text.matchAll(MENTION)].map((match) => ({
    id: `mention-${match.index}`,
    key: `mention:${match[0]}`,
    startIndex: match.index,
    endIndex: match.index + match[0].length,
    text: match[0],
    atomic: true,
    reveal: 'never',
    render: (element: HTMLElement) => {
      chips.renders += 1
      element.textContent = 'chip'
      return { dispose: () => (chips.disposals += 1) }
    },
  }))
}

function caret(): number {
  return editor.getState().cursor.column
}

function text(): string {
  return editor.materializeFullText()
}

function widgets(): readonly HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-editor-inline-widget]')].filter(
    (element) => element.isConnected,
  )
}

function textView(): VirtualizedTextView {
  const view: unknown = Reflect.get(editor, 'view')
  if (!(view instanceof VirtualizedTextView)) throw new TypeError('editor has no text view')
  return view
}

function viewState(): ReturnType<VirtualizedTextView['getState']> {
  return textView().getState()
}

/** Hides the characters at 2–4 of the text it was first given, as a parse of `abXXcd` would. */
function hideXXPlugin(): EditorPlugin {
  return {
    name: 'test.hideXX',
    activate: (context) =>
      context.registerInlineReplacementProvider?.(() => [
        { id: 'xx', startIndex: 2, endIndex: 4, text: '' },
      ]) ?? { dispose: () => undefined },
  }
}

function rowText(): string {
  return container.querySelector('[data-editor-virtual-row="0"]')?.textContent ?? ''
}

function editorRoot(): HTMLElement {
  return container.querySelector('.editor-virtualized') as HTMLElement
}

function typeText(data: string): void {
  editorRoot().dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data,
      inputType: 'insertText',
    }),
  )
}

describe('caret motion over an atomic replacement', () => {
  it('steps from the end of a chip to its start in one press', () => {
    mount(TEXT)
    editor.setSelection(CHIP_END)

    editor.dispatchCommand('cursorLeft')

    expect(caret()).toBe(CHIP_START)
  })

  it('steps from the start of a chip to its end in one press', () => {
    mount(TEXT)
    editor.setSelection(CHIP_START)

    editor.dispatchCommand('cursorRight')

    expect(caret()).toBe(CHIP_END)
  })

  it('stops a word move at the chip edge instead of the word inside its source', () => {
    mount(TEXT)
    editor.setSelection(CHIP_END + 1)

    editor.dispatchCommand('cursorWordLeft')

    expect(caret()).toBe(CHIP_START)
  })

  it('extends a selection over the whole chip', () => {
    mount(TEXT)
    editor.setSelection(CHIP_START)

    editor.dispatchCommand('selectRight')

    expect(editor.getSelections()).toEqual([
      expect.objectContaining({ anchorOffset: CHIP_START, headOffset: CHIP_END }),
    ])
  })
})

describe('deleting an atomic replacement', () => {
  it('takes the whole chip with one Backspace at its end', () => {
    mount(TEXT)
    editor.setSelection(CHIP_END)

    editor.dispatchCommand('deleteBackward')

    expect(text()).toBe('see  now')
    expect(caret()).toBe(CHIP_START)
  })

  it('takes the whole chip with one Delete at its start', () => {
    mount(TEXT)
    editor.setSelection(CHIP_START)

    editor.dispatchCommand('deleteForward')

    expect(text()).toBe('see  now')
  })

  it('widens a word delete that would cut into the chip', () => {
    mount(TEXT)
    editor.setSelection(CHIP_END)

    editor.dispatchCommand('deleteWordLeft')

    expect(text()).toBe('see  now')
  })

  it('widens a selection that ends inside the chip', () => {
    mount(TEXT)
    editor.setSelection(2, 8)

    editor.dispatchCommand('deleteBackward')

    expect(text()).toBe('se now')
  })

  it('deletes one character where no chip is touched', () => {
    mount(TEXT)
    editor.setSelection(3)

    editor.dispatchCommand('deleteBackward')

    expect(text()).toBe('se @src/foo.ts now')
  })

  it('brings the chip back with one undo', () => {
    mount(TEXT)
    editor.setSelection(CHIP_END)
    editor.dispatchCommand('deleteBackward')

    editor.dispatchCommand('undo')

    expect(text()).toBe(TEXT)
    expect(widgets()).toHaveLength(1)
  })
})

describe('replacements that never reveal', () => {
  it('keeps the chip painted with the caret against it', () => {
    mount(TEXT)

    editor.setSelection(CHIP_END)

    expect(widgets().map((element) => element.textContent)).toEqual(['chip'])
  })
})

describe('providers triggered by edits', () => {
  it('turns a mention typed into the text into a chip in the same edit', () => {
    mount('x')
    editor.setSelection(1)

    editor.edit({ from: 1, to: 1, text: ' @a/b.ts ' })

    expect(widgets()).toHaveLength(1)
  })

  it('hands the provider where the carets are', () => {
    const chips = mount('x')
    editor.setSelection(1)

    typeText('y')

    const last = chips.contexts.at(-1)
    expect(last?.selections.map((selection) => selection.headOffset)).toEqual([2])
  })

  it('keeps a keyed chip mounted across edits that move its id', () => {
    const chips = mount(TEXT)
    expect(chips.renders).toBe(1)

    editor.edit({ from: 0, to: 0, text: 'XX ' })

    expect(widgets()).toHaveLength(1)
    expect(chips.renders).toBe(1)
    expect(chips.disposals).toBe(0)
  })
})

describe('providers of both triggers on one editor', () => {
  it('carries syntax-derived replacements to the text an edit produced', () => {
    editor = createVisibleEditor(container, { rtlMoveVisually: false, plugins: [hideXXPlugin()] })
    editor.setText('abXXcd')
    editor.setInlineReplacementProvider(() => [], { trigger: 'edit' })
    expect(rowText()).toBe('abcd')

    editor.edit({ from: 0, to: 0, text: 'Z' })

    expect(rowText()).toBe('Zabcd')
  })

  it('derives edit-triggered replacements for text set after the provider', () => {
    const chips: Chips = { renders: 0, disposals: 0, contexts: [] }
    editor = createVisibleEditor(container, { rtlMoveVisually: false })
    editor.setInlineReplacementProvider((context) => mentionSpecs(chips, context), {
      trigger: 'edit',
    })

    editor.setText(TEXT)

    expect(widgets()).toHaveLength(1)
    editor.setSelection(CHIP_END)
    editor.dispatchCommand('cursorLeft')
    expect(caret()).toBe(CHIP_START)
  })
})

describe('host shape options', () => {
  it('leaves no room below the last row when scrolling past the end is off', () => {
    editor = createVisibleEditor(container, { scrollPastEnd: false })
    editor.setText(Array.from({ length: 5 }, (_, index) => `line ${index}`).join('\n'))
    textView().setScrollMetrics(0, 60)

    const state = viewState()
    expect(state.totalHeight).toBeGreaterThan(state.viewportHeight)
    expect(state.scrollHeight).toBe(state.totalHeight)
  })

  it('scrolls the last row to the top by default', () => {
    editor = createVisibleEditor(container)
    editor.setText(Array.from({ length: 5 }, (_, index) => `line ${index}`).join('\n'))
    textView().setScrollMetrics(0, 60)

    const state = viewState()
    expect(state.scrollHeight).toBeGreaterThan(state.totalHeight)
  })

  it('reports the content height as lines come and go', () => {
    editor = createVisibleEditor(container)
    editor.setText('one')
    const heights: number[] = []
    editor.onDidChangeContentHeight((height) => heights.push(height))
    const oneLine = editor.getContentHeight()

    editor.setText('one\ntwo\nthree')

    expect(heights.at(-1)).toBe(editor.getContentHeight())
    expect(editor.getContentHeight()).toBeGreaterThan(oneLine)
  })

  it('names the input and asks keyboards for prose', () => {
    editor = createVisibleEditor(container, { inputLabel: 'Message', inputKind: 'prose' })

    const input = editor.getInputElement()
    expect(input.getAttribute('aria-label')).toBe('Message')
    expect(input.getAttribute('autocapitalize')).toBe('sentences')
    expect(input.getAttribute('autocorrect')).toBe('on')
  })

  it('surrounds with its own pairs while auto-closing nothing', () => {
    editor = createVisibleEditor(container, {
      autoClosingPairs: [],
      surroundingPairs: [{ open: '*', close: '*' }],
    })
    editor.setText('word')

    editor.setSelection(0, 4)
    typeText('*')
    expect(text()).toBe('*word*')

    editor.setSelection(0)
    typeText('(')
    expect(text()).toBe('(*word*')
  })
})
