import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Editor } from '../src/editor/Editor'
import { resetEditorInstanceCount, setHighlightRegistry } from '../src/public/testing'
import { editorElement } from './editorElement'

/**
 * The element the editor listens on. `Editor.el` is private and neither the public API nor
 * src/public/testing.ts hands it back, yet these tests have to dispatch on that exact element or
 * the input pipeline never sees the event — hence the bracket access.
 */

/**
 * List continuation driven through the input path a browser actually uses for Enter, because the only
 * thing that makes the feature worth having is that the Enter key reaches it.
 */

const highlightsMap = new Map<string, unknown>()
const mockRegistry = {
  delete: (name: string) => highlightsMap.delete(name),
  set: (name: string, highlight: unknown) => {
    highlightsMap.set(name, highlight)
  },
}

class MockHighlight extends Set<Range> {}

function lineBreakEvent(): InputEvent {
  return new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertLineBreak',
  })
}

function enterKeyEvent(): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' })
}

describe('list continuation on Enter', () => {
  let container: HTMLElement
  let editor: Editor

  beforeEach(() => {
    highlightsMap.clear()
    // @ts-expect-error — happy-dom has no Highlight constructor
    globalThis.Highlight = MockHighlight
    setHighlightRegistry(mockRegistry)
    resetEditorInstanceCount()
    container = document.createElement('div')
    document.body.appendChild(container)
    editor = new Editor(container, {})
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
    setHighlightRegistry(undefined)
  })

  function open(text: string, languageId: string): void {
    editor.openDocument({ documentId: `doc.${languageId}`, languageId, text })
  }

  /** Opens `text` as markdown, puts the caret at `caret`, then presses Enter `presses` times. */
  function press(text: string, caret: number, presses = 1): string {
    open(text, 'markdown')
    editor.setSelection(caret)
    for (let index = 0; index < presses; index += 1)
      editorElement(editor).dispatchEvent(lineBreakEvent())

    return editor.materializeFullText()
  }

  it('carries a bullet onto the next line', () => {
    expect(press('- alpha', 7)).toBe('- alpha\n- ')
  })

  it('reproduces the marker and the width of its separator', () => {
    expect(press('*   alpha', 9)).toBe('*   alpha\n*   ')
    expect(press('+ alpha', 7)).toBe('+ alpha\n+ ')
  })

  it('keeps a nested item at its own indentation', () => {
    expect(press('    - alpha', 11)).toBe('    - alpha\n    - ')
  })

  it('advances an ordered number and keeps its delimiter', () => {
    expect(press('1. alpha', 8)).toBe('1. alpha\n2. ')
    expect(press('9) alpha', 8)).toBe('9) alpha\n10) ')
  })

  it('unticks a task box, because the next thing is not already done', () => {
    expect(press('- [x] done', 10)).toBe('- [x] done\n- [ ] ')
  })

  it('continues a block quote', () => {
    expect(press('> quoted', 8)).toBe('> quoted\n> ')
  })

  it('splits an item when the caret is inside its text', () => {
    expect(press('- alphabeta', 7)).toBe('- alpha\n- beta')
  })

  // Without this the feature is actively annoying: every list would end with a marker to delete.
  it('takes the marker away on an empty item rather than adding another', () => {
    expect(press('- alpha\n- ', 10)).toBe('- alpha\n\n')
    expect(press('1. alpha\n2. ', 12)).toBe('1. alpha\n\n')
    expect(press('- [ ] todo\n- [ ] ', 17)).toBe('- [ ] todo\n\n')
  })

  it('ends an indented list in two presses, leaving nothing behind', () => {
    expect(press('  - alpha', 9, 2)).toBe('  - alpha\n\n')
  })

  it('renumbers the items that follow one inserted mid-list', () => {
    expect(press('1. alpha\n2. beta\n3. gamma', 8)).toBe('1. alpha\n2. \n3. beta\n4. gamma')
  })

  it('steps over a sublist, which counts for itself', () => {
    expect(press('1. alpha\n   1. sub\n2. beta', 8)).toBe('1. alpha\n2. \n   1. sub\n3. beta')
  })

  it('stops renumbering where the list stops', () => {
    expect(press('1. alpha\n2. beta\n\n7. elsewhere', 8)).toBe(
      '1. alpha\n2. \n3. beta\n\n7. elsewhere',
    )
  })

  it('leaves a following bullet list alone, its numbering is not ours', () => {
    expect(press('1. alpha\n- beta', 8)).toBe('1. alpha\n2. \n- beta')
  })

  it('does nothing for a paragraph', () => {
    expect(press('alpha', 5)).toBe('alpha\n')
  })

  it('does not continue from in front of the marker', () => {
    expect(press('- alpha', 0)).toBe('\n- alpha')
    // The plain break still copies the indentation; what it must not do is lay down a marker.
    expect(press('    - alpha', 4)).toBe('    \n    - alpha')
  })

  it('does not continue over a selection', () => {
    open('- alpha', 'markdown')
    editor.setSelection(2, 7)

    editorElement(editor).dispatchEvent(lineBreakEvent())

    expect(editor.materializeFullText()).toBe('- \n')
  })

  it('is not a list marker where a line may open with a comment leader', () => {
    open('/**\n * ', 'typescript')
    editor.setSelection(7)

    editorElement(editor).dispatchEvent(lineBreakEvent())

    expect(editor.materializeFullText()).toBe('/**\n * \n * ')
  })

  it('reaches the feature from the keyboard fallback too', () => {
    open('- alpha', 'markdown')
    editor.setSelection(7)

    editorElement(editor).dispatchEvent(enterKeyEvent())

    expect(editor.materializeFullText()).toBe('- alpha\n- ')
  })
})
