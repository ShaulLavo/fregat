import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Editor } from '../src/editor'
import { resetEditorInstanceCount } from '../src/public/testing'

/**
 * Indentation is written in tab stops, so it should come back the same way. The
 * feature is only worth anything if the keyboard can reach it, which is what
 * these drive rather than the range helper underneath.
 */
describe('backspace inside indentation', () => {
  let container: HTMLElement
  let editor: Editor

  beforeEach(() => {
    resetEditorInstanceCount()
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
  })

  function mount(text: string, tabSize: number): void {
    editor = new Editor(container, { defaultText: text, tabSize })
  }

  it('takes back a whole tab stop', () => {
    mount('        alpha', 4)
    editor.setSelection(8)

    editor.dispatchCommand('deleteBackward')

    expect(editor.materializeFullText()).toBe('    alpha')
  })

  it('takes back to the nearest stop when the indent is ragged', () => {
    mount('      alpha', 4)
    editor.setSelection(6)

    editor.dispatchCommand('deleteBackward')

    expect(editor.materializeFullText()).toBe('    alpha')
  })

  it('takes one character once the caret has left the indentation', () => {
    mount('    alpha', 4)
    editor.setSelection(9)

    editor.dispatchCommand('deleteBackward')

    expect(editor.materializeFullText()).toBe('    alph')
  })

  it('leaves a tab alone, it is already one level', () => {
    mount('\t\talpha', 4)
    editor.setSelection(2)

    editor.dispatchCommand('deleteBackward')

    expect(editor.materializeFullText()).toBe('\talpha')
  })
})
