import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { DocumentSessionChange } from '../src/documentSession'
import { Editor } from '../src/editor/Editor'
import { createDocumentSession } from '../src/public/document'
import { resetEditorInstanceCount, setHighlightRegistry } from '../src/public/testing'
import { resolveSelection } from '../src/selections'
import { editorElement } from './editorElement'

/**
 * The element the editor listens on. `Editor.el` is private and neither the public API nor
 * src/public/testing.ts hands it back, yet these tests have to dispatch on that exact element or
 * the input pipeline never sees the event — hence the bracket access.
 */

/**
 * Auto-closing pairs driven through the real input path: a beforeinput event on the editor, the
 * document session, and the piece table. The decision rules themselves are unit-tested in
 * src/editor/autoClose.test.ts; this is about the wiring holding together.
 */

const highlightsMap = new Map<string, unknown>()
const mockRegistry = {
  delete: (name: string) => highlightsMap.delete(name),
  set: (name: string, highlight: unknown) => {
    highlightsMap.set(name, highlight)
  },
}

class MockHighlight extends Set<Range> {}

function insert(data: string): InputEvent {
  return new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    data,
    inputType: 'insertText',
  })
}

function lineBreak(): InputEvent {
  return new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertLineBreak',
  })
}

describe('auto-closing pairs', () => {
  let container: HTMLElement
  let editor: Editor
  let lastChange: DocumentSessionChange | null = null

  beforeEach(() => {
    lastChange = null
    highlightsMap.clear()
    // @ts-expect-error — happy-dom has no Highlight constructor
    globalThis.Highlight = MockHighlight
    setHighlightRegistry(mockRegistry)
    resetEditorInstanceCount()
    container = document.createElement('div')
    document.body.appendChild(container)
    editor = new Editor(container, {
      onChange: (_state, change) => {
        lastChange = change
      },
    })
    editor.openDocument({ documentId: 'main.ts', languageId: 'typescript', text: '' })
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
    setHighlightRegistry(undefined)
  })

  const type = (...characters: readonly string[]) => {
    for (const character of characters) editorElement(editor).dispatchEvent(insert(character))
  }

  /** Both ends of the one selection the last keystroke left behind, as offsets. */
  const selectionEnds = () => {
    const change = lastChange
    if (!change) throw new Error('the keystroke produced no change')

    const selection = change.selections.selections[0]
    if (!selection) throw new Error('the keystroke left no selection')

    const resolved = resolveSelection(change.snapshot, selection)
    return { anchor: resolved.anchorOffset, head: resolved.headOffset }
  }

  const selectionAffinity = () => {
    const change = lastChange
    if (!change) throw new Error('the keystroke produced no change')

    const selection = change.selections.selections[0]
    if (!selection) throw new Error('the keystroke left no selection')
    return resolveSelection(change.snapshot, selection).affinity
  }

  it('inserts the closer and leaves the caret between the halves', () => {
    type('(')

    expect(editor.materializeFullText()).toBe('()')
    expect(editor.getState().cursor).toMatchObject({ column: 1, row: 0 })
  })

  it('preserves affinity when inserting an auto-closing pair', () => {
    const session = createDocumentSession('')
    session.setSelection(0, 0, { affinity: 'before' })
    editor.attachSession(session, { languageId: 'typescript' })
    editor.focus()

    type('(')

    expect(selectionAffinity()).toBe('before')
  })

  // Text with no beforeinput to carry it — an autocorrection, a dictated phrase, a soft keyboard's
  // suggestion — is read back off the hidden input instead, and has to reach the document by the
  // same route a typed character does or none of the typing behaviours apply to it.
  it('closes a pair for a character deduced from the hidden input', () => {
    editor.focus()
    const input = editorElement(editor).querySelector(
      '.editor-virtualized-input',
    ) as HTMLTextAreaElement
    input.value = '('
    input.setSelectionRange(1, 1)
    input.dispatchEvent(new Event('input', { bubbles: true }))

    expect(editor.materializeFullText()).toBe('()')
    expect(selectionEnds()).toEqual({ anchor: 1, head: 1 })
  })

  it('keeps typing inside the pair', () => {
    type('(', 'a')

    expect(editor.materializeFullText()).toBe('(a)')
  })

  it('types over its own closer instead of adding another', () => {
    type('(', ')')

    expect(editor.materializeFullText()).toBe('()')
    expect(editor.getState().cursor).toMatchObject({ column: 2, row: 0 })
  })

  it('uses forward affinity when typing over its own closer', () => {
    const session = createDocumentSession('')
    editor.attachSession(session, { languageId: 'typescript' })
    type('(')
    session.setSelection(1, 1, { affinity: 'after' })

    type(')')

    expect(selectionAffinity()).toBe('before')
  })

  it('types over the closer even after editing inside the pair', () => {
    type('(', 'a', 'b', ')')

    expect(editor.materializeFullText()).toBe('(ab)')
  })

  // A closer the editor did not insert must still be typeable.
  it('inserts a closer that was not auto-inserted', () => {
    editor.setText(')')
    editor.setSelection(0, 0)

    type(')')

    expect(editor.materializeFullText()).toBe('))')
  })

  it('backspacing between the halves removes both', () => {
    type('(')
    editor.dispatchCommand('deleteBackward')

    expect(editor.materializeFullText()).toBe('')
  })

  it('preserves affinity when removing an auto-closing pair', () => {
    const session = createDocumentSession('')
    session.setSelection(0, 0, { affinity: 'before' })
    editor.attachSession(session, { languageId: 'typescript' })
    editor.focus()
    type('(')

    editor.dispatchCommand('deleteBackward')

    expect(selectionAffinity()).toBe('before')
  })

  it('backspacing a hand-typed pair removes only one character', () => {
    editor.setText('()')
    editor.setSelection(1, 1)

    editor.dispatchCommand('deleteBackward')

    expect(editor.materializeFullText()).toBe(')')
  })

  it('does not close directly before a word', () => {
    editor.setText('abc')
    editor.setSelection(0, 0)

    type('(')

    expect(editor.materializeFullText()).toBe('(abc')
  })

  it('closes quotes on their own', () => {
    type('"')

    expect(editor.materializeFullText()).toBe('""')
  })

  // don't, it's — the apostrophe is punctuation, not a delimiter.
  it('does not close an apostrophe after a word character', () => {
    editor.setText('don')
    editor.setSelection(3, 3)

    type("'")

    expect(editor.materializeFullText()).toBe("don'")
  })

  // The pairing auto-close exists for: the closer moves to its own line and the caret lands on a
  // blank indented line between them.
  it('expands into a block when Enter is pressed inside a pair', () => {
    type('(')
    editorElement(editor).dispatchEvent(lineBreak())

    expect(editor.materializeFullText()).toBe('(\n    \n)')
    expect(editor.getState().cursor).toMatchObject({ column: 4, row: 1 })
  })

  it('continues the previous line indentation', () => {
    editor.setText('    foo')
    editor.setSelection(7, 7)

    editorElement(editor).dispatchEvent(lineBreak())

    expect(editor.materializeFullText()).toBe('    foo\n    ')
  })

  it('preserves affinity through an indented line break', () => {
    const session = createDocumentSession('    foo')
    session.setSelection(7, 7, { affinity: 'before' })
    editor.attachSession(session, { languageId: 'typescript' })
    editor.focus()

    editorElement(editor).dispatchEvent(lineBreak())

    expect(selectionAffinity()).toBe('before')
  })

  it('indents one level deeper after an opener with no closer following', () => {
    editor.setText('  if (x) {', { languageId: 'typescript' })
    editor.setSelection(10, 10)

    editorElement(editor).dispatchEvent(lineBreak())

    expect(editor.materializeFullText()).toBe('  if (x) {\n      ')
  })

  it('keeps tabs when the line uses tabs', () => {
    editor.setText('\tif (x) {', { languageId: 'typescript' })
    editor.setSelection(9, 9)

    editorElement(editor).dispatchEvent(lineBreak())

    expect(editor.materializeFullText()).toBe('\tif (x) {\n\t\t')
  })

  it('adds no indentation at the top level', () => {
    editor.setText('foo')
    editor.setSelection(3, 3)

    editorElement(editor).dispatchEvent(lineBreak())

    expect(editor.materializeFullText()).toBe('foo\n')
  })

  it('wraps a selection instead of replacing it', () => {
    editor.setText('foo bar', { languageId: 'typescript' })
    editor.setSelection(0, 3)

    type('(')

    expect(editor.materializeFullText()).toBe('(foo) bar')
    // Stopping short of the closer is what lets the next wrap nest inside this one.
    expect(selectionEnds()).toEqual({ anchor: 1, head: 4 })
  })

  it('preserves direction and affinity when wrapping a selection', () => {
    const session = createDocumentSession('foo bar')
    session.setSelection(3, 0, { affinity: 'before' })
    editor.attachSession(session, { languageId: 'typescript' })
    editor.focus()

    type('(')

    expect(selectionEnds()).toEqual({ anchor: 4, head: 1 })
    expect(selectionAffinity()).toBe('before')
  })

  it('wraps with quotes too', () => {
    editor.setText('foo', { languageId: 'typescript' })
    editor.setSelection(0, 3)

    type('"')

    expect(editor.materializeFullText()).toBe('"foo"')
  })

  // The wrapped text stays selected, so a second wrap nests rather than starting over.
  it('keeps the wrapped text selected', () => {
    editor.setText('foo', { languageId: 'typescript' })
    editor.setSelection(0, 3)

    type('(', '[')

    expect(editor.materializeFullText()).toBe('([foo])')
  })

  // The wrapped text reads the same whichever end the caret kept, so only the ends themselves say
  // the direction survived — the next shift+arrow has to go on from the end the user was moving.
  it('wraps a backwards selection and keeps its direction', () => {
    editor.setText('foo bar', { languageId: 'typescript' })
    editor.setSelection(3, 0)

    type('(')

    expect(editor.materializeFullText()).toBe('(foo) bar')
    expect(selectionEnds()).toEqual({ anchor: 4, head: 1 })
  })

  it('does not close a quote typed inside a string', () => {
    editor.setText('const s = "abc  def"', { languageId: 'typescript' })
    editor.setSelection(15, 15)

    type("'")

    expect(editor.materializeFullText()).toBe('const s = "abc \' def"')
  })

  it('does not close a bracket typed inside a line comment', () => {
    editor.setText('// wrap this', { languageId: 'typescript' })
    editor.setSelection(7, 7)

    type('(')

    expect(editor.materializeFullText()).toBe('// wrap( this')
  })

  // Nothing in the characters around the caret says the quote ends the run it is standing in; the
  // line read with a harmless character in the quote's place is what says so.
  it('does not close a quote that would terminate an unterminated string', () => {
    editor.setText("const s = '(abc ", { languageId: 'typescript' })
    editor.setSelection(16, 16)

    type("'")

    expect(editor.materializeFullText()).toBe("const s = '(abc '")
  })

  // A bracket in front of a literal is how `("x")` gets typed; a quote in front of one is not.
  it('closes a bracket before a string but not a quote before one', () => {
    editor.setText('"foo"', { languageId: 'typescript' })
    editor.setSelection(0, 0)

    type('(')

    expect(editor.materializeFullText()).toBe('()"foo"')

    editor.setText('"foo"', { languageId: 'typescript' })
    editor.setSelection(0, 0)

    type('"')

    expect(editor.materializeFullText()).toBe('""foo"')
  })

  it('wraps every selection when several cursors are down', () => {
    editor.setText('one one one', { languageId: 'typescript' })
    editor.setSelection(0, 3)
    editor.dispatchCommand('addNextOccurrence')
    editor.dispatchCommand('addNextOccurrence')

    type('"')

    expect(editor.materializeFullText()).toBe('"one" "one" "one"')
  })

  // Every wrap stays selected, so a second keystroke nests instead of starting over — the same
  // contract the single-cursor wrap has.
  it('keeps every wrapped selection selected', () => {
    editor.setText('one one one', { languageId: 'typescript' })
    editor.setSelection(0, 3)
    editor.dispatchCommand('addNextOccurrence')
    editor.dispatchCommand('addNextOccurrence')

    type('"', '(')

    expect(editor.materializeFullText()).toBe('"(one)" "(one)" "(one)"')
  })

  it('undoes every wrap in one step', () => {
    editor.setText('one one one', { languageId: 'typescript' })
    editor.setSelection(0, 3)
    editor.dispatchCommand('addNextOccurrence')
    editor.dispatchCommand('addNextOccurrence')

    type('"')
    expect(editor.materializeFullText()).toBe('"one" "one" "one"')

    editor.dispatchCommand('undo')
    expect(editor.materializeFullText()).toBe('one one one')
  })

  // The closer of one and the opener of the next land on the same offset here, so this is what says
  // they went in the right order.
  it('wraps selections that meet at an offset', () => {
    editor.setText('abab', { languageId: 'typescript' })
    editor.setSelection(0, 2)
    editor.dispatchCommand('addNextOccurrence')

    type('(')

    expect(editor.materializeFullText()).toBe('(ab)(ab)')
  })

  // Typing over selected blanks is a correction, not a wrap.
  it('replaces a selection that is only whitespace', () => {
    editor.setText('a    b', { languageId: 'typescript' })
    editor.setSelection(1, 5)

    type('"')

    expect(editor.materializeFullText()).toBe('a"b')
  })

  it('replaces a lone selected quote when a quote is typed over it', () => {
    editor.setText("x = 'y'", { languageId: 'typescript' })
    editor.setSelection(4, 5)

    type('"')

    expect(editor.materializeFullText()).toBe('x = "y\'')
  })

  it('still wraps a lone selected quote in a bracket', () => {
    editor.setText("x = 'y'", { languageId: 'typescript' })
    editor.setSelection(4, 5)

    type('(')

    expect(editor.materializeFullText()).toBe("x = (')y'")
  })

  // One cursor wrapping while another replaced the text under it would destroy text for a reason
  // the keystroke does not show, so the whole set falls back to replacing.
  it('wraps nothing when one of several cursors has no selection', () => {
    editor.setText('foo\nbar', { languageId: 'typescript' })
    editor.setSelection(0, 3)
    editor.dispatchCommand('editor.action.insertCursorBelow')

    type('"')

    expect(editor.materializeFullText()).toBe('"\nbar"')
  })

  it('auto-closes in a language with no entry of its own', () => {
    editor.openDocument({ documentId: 'notes.txt', languageId: null, text: '' })

    type('(')

    expect(editor.materializeFullText()).toBe('()')
  })

  // The reason quotes used to be left out of the unknown-language set, handled where it belongs.
  it('keeps an apostrophe after a word in a language with no entry of its own', () => {
    editor.openDocument({ documentId: 'notes.txt', languageId: null, text: '' })

    for (const character of "don't") type(character)

    expect(editor.materializeFullText()).toBe("don't")
  })

  it('undoes the whole pair in one step', () => {
    type('(')
    editor.dispatchCommand('undo')

    expect(editor.materializeFullText()).toBe('')
  })

  // Undo history is deliberately not coalesced across an auto-close: the pair is its own
  // transaction, so the character typed after it undoes separately.
  it('undoes a character typed inside the pair before the pair itself', () => {
    type('(', 'a')

    editor.dispatchCommand('undo')
    expect(editor.materializeFullText()).toBe('()')

    editor.dispatchCommand('undo')
    expect(editor.materializeFullText()).toBe('')
  })
})
