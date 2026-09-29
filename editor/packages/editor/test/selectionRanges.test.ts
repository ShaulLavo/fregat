import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectPlatform } from '@tanstack/hotkeys'

import { Editor } from '../src/editor'
import { defaultEditorKeyBindings, editorCommandPackForCommand } from '../src/editor/keymap'
import type { EditorPlugin } from '../src/plugins'
import { createDocumentSession, type DocumentSession } from '../src/public/document'
import { resetEditorInstanceCount } from '../src/public/testing'
import { resolveSelection } from '../src/selections'
import type { EditorSyntaxLanguageId, FoldRange } from '../src/syntax/session'

// Indented so that 'the line without its indentation' and 'the whole line' are distinguishable.
const TEXT = '  const alpha = 1\nconst beta = 2\n'
const ALPHA = TEXT.indexOf('alpha')
const BETA = TEXT.indexOf('beta')

const NESTED = 'function outer() {\n  if (ready) {\n    run(value)\n  }\n}\n'
const NESTED_FOLDS: readonly FoldRange[] = [
  { startIndex: 0, endIndex: 54, startLine: 0, endLine: 4, type: 'function' },
  { startIndex: 21, endIndex: 52, startLine: 1, endLine: 3, type: 'block' },
]

describe('smart select', () => {
  let container: HTMLElement
  let editor: Editor

  beforeEach(() => {
    resetEditorInstanceCount()
    container = document.createElement('div')
    document.body.appendChild(container)
    editor = new Editor(container)
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
  })

  it('climbs word, line content and whole line in a document with no grammar', () => {
    const session = attach(TEXT, ALPHA + 2)

    expect(editor.dispatchCommand('editor.action.smartSelect.expand')).toBe(true)
    expect(selectedText(session)).toBe('alpha')

    expect(editor.dispatchCommand('editor.action.smartSelect.expand')).toBe(true)
    expect(selectedText(session)).toBe('const alpha = 1')

    expect(editor.dispatchCommand('editor.action.smartSelect.expand')).toBe(true)
    expect(selectedText(session)).toBe('  const alpha = 1')

    expect(editor.dispatchCommand('editor.action.smartSelect.expand')).toBe(true)
    expect(selectedText(session)).toBe(TEXT)

    expect(editor.dispatchCommand('editor.action.smartSelect.expand')).toBe(false)
  })

  it('climbs the nesting a grammar contributes', () => {
    editor.setPlugins([grammarSelectionRangePlugin()])
    const session = attach(NESTED, NESTED.indexOf('value') + 2, 'typescript')
    editor.setSyntaxFolds(NESTED_FOLDS)

    expect(climb(session)).toEqual([
      'value',
      'run(value)',
      '    run(value)',
      'if (ready) {\n    run(value)\n  }',
      '  if (ready) {\n    run(value)\n  }',
      'function outer() {\n  if (ready) {\n    run(value)\n  }\n}',
      NESTED,
    ])
  })

  it('offers a line that holds nothing but indentation', () => {
    const text = 'const alpha = 1\n    \nconst beta = 2\n'
    const session = attach(text, text.indexOf('\n') + 3)

    expect(editor.dispatchCommand('editor.action.smartSelect.expand')).toBe(true)
    expect(selectedText(session)).toBe('    ')

    expect(editor.dispatchCommand('editor.action.smartSelect.expand')).toBe(true)
    expect(selectedText(session)).toBe(text)
  })

  it('walks back down the ladder it climbed', () => {
    const session = attach(TEXT, ALPHA + 2)

    editor.dispatchCommand('editor.action.smartSelect.expand')
    editor.dispatchCommand('editor.action.smartSelect.expand')

    expect(editor.dispatchCommand('editor.action.smartSelect.shrink')).toBe(true)
    expect(selectedText(session)).toBe('alpha')

    expect(editor.dispatchCommand('editor.action.smartSelect.shrink')).toBe(true)
    expect(selectedText(session)).toBe('')

    expect(editor.dispatchCommand('editor.action.smartSelect.shrink')).toBe(false)
  })

  it('stops at the subword the caret sits in', () => {
    const session = attach('const parseHTTPResponse = 1\n', 8)

    expect(editor.dispatchCommand('editor.action.smartSelect.expand')).toBe(true)
    expect(selectedText(session)).toBe('parse')

    expect(editor.dispatchCommand('editor.action.smartSelect.expand')).toBe(true)
    expect(selectedText(session)).toBe('parseHTTPResponse')
  })

  it('takes the subword a caret on a boundary is about to enter', () => {
    const text = 'const parseHTTPResponse = 1\n'
    const session = attach(text, text.indexOf('HTTP'))

    expect(editor.dispatchCommand('editor.action.smartSelect.expand')).toBe(true)
    expect(selectedText(session)).toBe('HTTP')
  })

  it('expands from the keyboard', () => {
    const session = attach(TEXT, ALPHA + 2)

    const event = dispatchSmartSelectKey('ArrowRight')

    expect(selectedText(session)).toBe('alpha')
    expect(event.defaultPrevented).toBe(true)
  })

  it('shrinks from the keyboard', () => {
    const session = attach(TEXT, ALPHA + 2)

    dispatchSmartSelectKey('ArrowRight')
    dispatchSmartSelectKey('ArrowRight')
    dispatchSmartSelectKey('ArrowLeft')

    expect(selectedText(session)).toBe('alpha')
  })

  it('starts a new ladder when the caret has moved on', () => {
    const session = attach(TEXT, ALPHA + 2)

    editor.dispatchCommand('editor.action.smartSelect.expand')
    editor.dispatchCommand('editor.action.smartSelect.expand')
    editor.setSelection(BETA + 2)

    expect(editor.dispatchCommand('editor.action.smartSelect.expand')).toBe(true)
    expect(selectedText(session)).toBe('beta')
  })

  it('remeasures the ladder after an edit the selection did not feel', () => {
    const session = attach(TEXT, ALPHA + 2)

    expect(editor.dispatchCommand('editor.action.smartSelect.expand')).toBe(true)
    expect(selectedText(session)).toBe('alpha')
    session.applyEdits([{ from: TEXT.indexOf('\n'), to: TEXT.indexOf('\n'), text: ' + 2' }])

    expect(editor.dispatchCommand('editor.action.smartSelect.expand')).toBe(true)
    expect(selectedText(session)).toBe('const alpha = 1 + 2')
  })

  it('refuses to shrink into a ladder the caret has left', () => {
    attach(TEXT, ALPHA + 2)

    expect(editor.dispatchCommand('editor.action.smartSelect.expand')).toBe(true)
    editor.setSelection(BETA + 2)

    expect(editor.dispatchCommand('editor.action.smartSelect.shrink')).toBe(false)
  })

  it('keeps the direction the selection was made in', () => {
    const session = attach(TEXT, ALPHA)
    session.setSelection(ALPHA + 'alpha'.length, ALPHA)

    expect(editor.dispatchCommand('editor.action.smartSelect.expand')).toBe(true)
    expect(selectedText(session)).toBe('const alpha = 1')
    expect(selectionRange(session)).toEqual({
      anchor: TEXT.indexOf('\n'),
      head: TEXT.indexOf('const'),
    })
  })

  it('grows every cursor', () => {
    const session = attach(TEXT, ALPHA)
    session.setSelections([
      { anchor: ALPHA + 2, head: ALPHA + 2 },
      { anchor: BETA + 2, head: BETA + 2 },
    ])

    expect(editor.dispatchCommand('editor.action.smartSelect.expand')).toBe(true)
    expect(selectedTexts(session)).toEqual(['alpha', 'beta'])
  })

  // A binding whose hotkey is already taken is dropped from the layer, and a command with no pack
  // never reaches a layer at all.
  it.each(['editor.action.smartSelect.expand', 'editor.action.smartSelect.shrink'] as const)(
    'gives %s a pack and a default binding on every platform',
    (command) => {
      expect(editorCommandPackForCommand(command)).toBe('selection')

      for (const platform of ['mac', 'windows', 'linux'] as const) {
        expect(defaultEditorKeyBindings(platform).map((binding) => binding.command)).toContain(
          command,
        )
      }
    },
  )

  function attach(
    text: string,
    caret: number,
    languageId?: EditorSyntaxLanguageId,
  ): DocumentSession {
    const session = createDocumentSession(text)
    session.setSelection(caret)
    editor.attachSession(session, { languageId })
    return session
  }

  function climb(session: DocumentSession): readonly string[] {
    const rungs: string[] = []
    while (editor.dispatchCommand('editor.action.smartSelect.expand')) {
      rungs.push(selectedText(session))
    }
    return rungs
  }
})

/** Contributes the same bucket a grammar-backed plugin does: the nesting the parse published. */
function grammarSelectionRangePlugin(): EditorPlugin {
  return {
    name: 'test.grammar-selection-ranges',
    activate: (context) =>
      context.registerSelectionRangeProvider(({ folds }) =>
        folds.map((fold) => ({ start: fold.startIndex, end: fold.endIndex })),
      ),
  }
}

function smartSelectModifier(): KeyboardEventInit {
  return detectPlatform() === 'mac'
    ? { metaKey: true, ctrlKey: true, shiftKey: true }
    : { altKey: true, shiftKey: true }
}

function dispatchSmartSelectKey(key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key,
    ...smartSelectModifier(),
  })
  ;(document.querySelector('.editor-virtualized') as HTMLElement).dispatchEvent(event)
  return event
}

function selectionRange(session: DocumentSession): { anchor: number; head: number } {
  const selection = session.getSelections().selections[0]!
  const resolved = resolveSelection(session.getSnapshot(), selection)
  return { anchor: resolved.anchorOffset, head: resolved.headOffset }
}

function selectedTexts(session: DocumentSession): readonly string[] {
  const text = session.materializeFullText()
  return session.getSelections().selections.map((selection) => {
    const resolved = resolveSelection(session.getSnapshot(), selection)
    return text.slice(resolved.startOffset, resolved.endOffset)
  })
}

function selectedText(session: DocumentSession): string {
  return selectedTexts(session)[0] ?? ''
}
