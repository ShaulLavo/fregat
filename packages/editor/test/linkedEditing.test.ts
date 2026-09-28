import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { DocumentSessionChange } from '../src/documentSession'
import { Editor } from '../src/editor/Editor'
import { registerEditorLanguageConfiguration } from '../src/editor/languageConfiguration'
import type { EditorDisposable } from '../src/editor/disposables'
import { createDocumentSession } from '../src/public/document'
import { resetEditorInstanceCount, setHighlightRegistry } from '../src/public/testing'
import { resolveSelection } from '../src/selections'
import { editorElement } from './editorElement'

/**
 * Renaming a tag, driven through the real input path: beforeinput events on the editor, the
 * document session and the piece table. Nothing here calls the mirroring helpers directly — a mirror
 * no keystroke can reach is exactly the failure this is guarding against.
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

describe('linked editing', () => {
  let container: HTMLElement
  let editor: Editor
  let changes: DocumentSessionChange[]
  let registrations: EditorDisposable[]

  beforeEach(() => {
    highlightsMap.clear()
    // @ts-expect-error — happy-dom has no Highlight constructor
    globalThis.Highlight = MockHighlight
    setHighlightRegistry(mockRegistry)
    resetEditorInstanceCount()
    changes = []
    registrations = []
    container = document.createElement('div')
    document.body.appendChild(container)
    editor = new Editor(container, {
      onChange: (_state, change) => {
        if (change?.kind === 'edit') changes.push(change)
      },
    })
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
    for (const registration of registrations) registration.dispose()
    setHighlightRegistry(undefined)
  })

  const open = (languageId: string, text: string) => {
    editor.openDocument({ documentId: `main.${languageId}`, languageId, text })
    changes.length = 0
  }

  const type = (...characters: readonly string[]) => {
    // The scroll element is where the input handlers are bound. It is private on Editor and no
    // testing seam exposes it, and its class is shared with every other virtualized view a host may
    // mount, so a DOM query could answer with the wrong one.
    for (const character of characters) editorElement(editor).dispatchEvent(insert(character))
  }

  it('carries a typed character into the closing tag', () => {
    open('tsx', '<div>hi</div>')
    editor.setSelection(4, 4)

    type('x')

    expect(editor.materializeFullText()).toBe('<divx>hi</divx>')
    expect(editor.getState().cursor).toMatchObject({ column: 5, row: 0 })
  })

  it('keeps affinity while carrying a typed character into the closing tag', () => {
    const session = createDocumentSession('<div>hi</div>')
    editor.attachSession(session, { languageId: 'tsx' })
    session.setSelection(4, 4, { affinity: 'before' })
    editor.focus()

    type('x')

    const selection = session.getSelections().selections[0]
    expect(selection).toBeDefined()
    expect(resolveSelection(session.getSnapshot(), selection!).affinity).toBe('before')
  })

  it('keeps mirroring across a run of keystrokes', () => {
    open('tsx', '<div>hi</div>')
    editor.setSelection(4, 4)

    type('x', 'y', 'z')

    expect(editor.materializeFullText()).toBe('<divxyz>hi</divxyz>')
  })

  it('mirrors an inserted character as an insertion, not as a replaced name', () => {
    open('tsx', '<div>hi</div>')
    editor.setSelection(4, 4)

    type('x')

    expect(changes.at(-1)?.edits).toEqual([
      { from: 4, to: 4, text: 'x' },
      { from: 12, to: 12, text: 'x' },
    ])
  })

  it('leaves the untouched ends of the mirrored name alone', () => {
    open('tsx', '<div>hi</div>')
    // The middle character of the opening name, replaced: only the middle of the closing name may
    // move with it.
    editor.setSelection(2, 3)

    type('oo')

    expect(editor.materializeFullText()).toBe('<doov>hi</doov>')
    expect(changes.at(-1)?.edits).toEqual([
      { from: 2, to: 3, text: 'oo' },
      { from: 10, to: 11, text: 'oo' },
    ])
  })

  it('follows the caret to another element instead of holding the ranges it had', () => {
    open('tsx', '<div>hi</div><span>x</span>')
    editor.setSelection(4, 4)
    type('x')

    editor.setSelection(20, 20)
    type('z')

    expect(editor.materializeFullText()).toBe('<divx>hi</divx><spanz>x</spanz>')
  })

  it('goes on renaming the pair it began on after another tag takes the same name', () => {
    open('tsx', '<di><div>x</di>')
    editor.setSelection(3, 3)

    type('v')

    // Markup halfway through being written: the tag inside is not closed yet and now carries the
    // name being typed, so reading the text afresh would hand it the closing tag and give up.
    expect(editor.materializeFullText()).toBe('<div><div>x</div>')

    type('x')

    expect(editor.materializeFullText()).toBe('<divx><div>x</divx>')
  })

  // The batch that carries a name into its partner has one caret to hand back, so it cannot also be
  // the keystroke of every other cursor.
  it('types plainly while several cursors are down', () => {
    open('tsx', '<div>hi</div>\n<div>hi</div>')
    editor.setSelection(4, 4)
    editor.dispatchCommand('editor.action.insertCursorBelow')

    type('x')

    expect(editor.materializeFullText()).toBe('<divx>hi</div>\n<divx>hi</div>')
  })

  it('carries a backspace into the closing tag', () => {
    open('tsx', '<divx>hi</divx>')
    editor.setSelection(5, 5)

    editor.dispatchCommand('deleteBackward')

    // A deletion the partner never hears leaves a mismatched pair, and a
    // mismatched pair no longer scans as one, so it can never re-link.
    expect(editor.materializeFullText()).toBe('<div>hi</div>')
  })

  // The same key by the other name: a forward delete takes exactly what a backspace over the same
  // selection takes, so the two cannot disagree about whether the partner hears it.
  it('carries a forward delete into the closing tag', () => {
    open('tsx', '<divx>hi</divx>')
    editor.setSelection(4, 5)

    editor.dispatchCommand('deleteForward')

    expect(editor.materializeFullText()).toBe('<div>hi</div>')
  })

  it('keeps mirroring after a backspace', () => {
    open('tsx', '<divx>hi</divx>')
    editor.setSelection(5, 5)

    editor.dispatchCommand('deleteBackward')
    type('y')

    expect(editor.materializeFullText()).toBe('<divy>hi</divy>')
  })

  it('takes a mirrored backspace back in one undo', () => {
    open('tsx', '<divx>hi</divx>')
    editor.setSelection(5, 5)

    editor.dispatchCommand('deleteBackward')
    editor.dispatchCommand('undo')

    expect(editor.materializeFullText()).toBe('<divx>hi</divx>')
  })

  it('takes both halves back in one undo', () => {
    open('tsx', '<div>hi</div>')
    editor.setSelection(4, 4)
    type('x')

    editor.dispatchCommand('undo')

    expect(editor.materializeFullText()).toBe('<div>hi</div>')
  })

  it('renames the opening tag when the caret is in the closing one', () => {
    open('tsx', '<div>hi</div>')
    editor.setSelection(12, 12)

    type('x')

    expect(editor.materializeFullText()).toBe('<divx>hi</divx>')
    // The caret is handed back past the character it typed and past the insertion in front of it.
    expect(editor.getState().cursor).toMatchObject({ column: 14, row: 0 })
  })

  it('replaces a selected name in both tags at once', () => {
    open('tsx', '<div>hi</div>')
    editor.setSelection(1, 4)

    type('s')

    expect(editor.materializeFullText()).toBe('<s>hi</s>')
  })

  it('pairs the tag that closes the element, not the nearest name like it', () => {
    open('tsx', '<div><div>hi</div></div>')
    editor.setSelection(4, 4)

    type('x')

    expect(editor.materializeFullText()).toBe('<divx><div>hi</div></divx>')
  })

  it('pairs an inner element from its own opening tag', () => {
    open('tsx', '<div><div>hi</div></div>')
    editor.setSelection(9, 9)

    type('x')

    expect(editor.materializeFullText()).toBe('<div><divx>hi</divx></div>')
  })

  // A tag that closes itself is not an opener, so it neither claims the closing tag of the element
  // around it nor stops that element from finding it.
  it('renames around a self-closing tag of the same name', () => {
    open('tsx', '<Foo><Foo/></Foo>')
    editor.setSelection(4, 4)

    type('x')

    expect(editor.materializeFullText()).toBe('<Foox><Foo/></Foox>')
  })

  it('leaves a self-closing tag with nothing to mirror', () => {
    open('tsx', '<Foo><Foo/></Foo>')
    editor.setSelection(9, 9)

    type('x')

    expect(editor.materializeFullText()).toBe('<Foo><Foox/></Foo>')
  })

  // The slash is a token of the tag, not a character stuck to its `>`: a space between the two does
  // not stop the tag closing itself.
  it('renames around a tag that closes itself a space before its end', () => {
    open('tsx', '<Foo><Foo / ></Foo>')
    editor.setSelection(4, 4)

    type('x')

    expect(editor.materializeFullText()).toBe('<Foox><Foo / ></Foox>')
  })

  // An attribute value is text. The `>` in it ends nothing, so the markup written after that `>` is
  // still inside the value and is not a tag of its own.
  it('renames past a closing tag written inside a quoted attribute value', () => {
    open('tsx', '<div title="1 > 2 </div>">hi</div>')
    editor.setSelection(4, 4)

    type('x')

    expect(editor.materializeFullText()).toBe('<divx title="1 > 2 </div>">hi</divx>')
  })

  // An expression is the other place a `>` can be a comparison, and there nothing but the braces
  // says so: this one stands outside the quotes, where the rule above cannot reach it.
  it('renames past a closing tag written inside a braced attribute expression', () => {
    open('tsx', "<div x={a > 0 && '</div>'}>hi</div>")
    editor.setSelection(4, 4)

    type('x')

    expect(editor.materializeFullText()).toBe("<divx x={a > 0 && '</div>'}>hi</divx>")
  })

  it('mirrors an element tag in a markup document', () => {
    open('html', '<section>hi</section>')
    editor.setSelection(8, 8)

    type('s')

    expect(editor.materializeFullText()).toBe('<sections>hi</sections>')
  })

  // A void element never closes, so it is on the stack when the element around it does.
  it('renames past an element that is never closed', () => {
    open('html', '<div><br>hi</div>')
    editor.setSelection(4, 4)

    type('x')

    expect(editor.materializeFullText()).toBe('<divx><br>hi</divx>')
  })

  // Each of the three characters below sits mid-name on purpose: taken for a boundary, it would end
  // the rename at half a name and leave the partner alone.
  it("carries a custom element's hyphen with the name", () => {
    open('html', '<my-widget>hi</my-widget>')
    editor.setSelection(10, 10)

    type('s')

    expect(editor.materializeFullText()).toBe('<my-widgets>hi</my-widgets>')
  })

  it('carries a namespace colon with the name', () => {
    open('html', '<svg:rect>hi</svg:rect>')
    editor.setSelection(9, 9)

    type('s')

    expect(editor.materializeFullText()).toBe('<svg:rects>hi</svg:rects>')
  })

  it('carries a member dot with the name', () => {
    open('tsx', '<Foo.Bar>hi</Foo.Bar>')
    editor.setSelection(8, 8)

    type('s')

    expect(editor.materializeFullText()).toBe('<Foo.Bars>hi</Foo.Bars>')
  })

  // A completion taken in the opening tag is that tag being renamed, whoever wrote the characters.
  // Written straight through it leaves the pair mismatched, and a mismatched pair no longer scans
  // as one — so nothing the reader types afterwards can ever reach the closing tag again.
  it('carries an accepted suggestion into the closing tag', () => {
    open('tsx', '<div>hi</div>')
    editor.setSelection(4, 4)

    editor.setInlineSuggestion({ from: 1, to: 4, text: 'divider' })
    expect(editor.dispatchCommand('editor.action.inlineSuggest.commit')).toBe(true)

    expect(editor.materializeFullText()).toBe('<divider>hi</divider>')

    type('X')

    expect(editor.materializeFullText()).toBe('<dividerX>hi</dividerX>')
  })

  it('ends the link once the name stops being one word', () => {
    open('tsx', '<div>hi</div>')
    editor.setSelection(4, 4)

    type('>')

    expect(editor.materializeFullText()).toBe('<div>>hi</div>')
  })

  it('does not mirror in a language that mirrors nothing', () => {
    open('typescript', '<div>hi</div>')
    editor.setSelection(4, 4)

    type('x')

    expect(editor.materializeFullText()).toBe('<divx>hi</div>')
  })

  it("holds the link to the language's own idea of a word", () => {
    registrations.push(
      registerEditorLanguageConfiguration('lettersonly', {
        autoClosingPairs: [],
        brackets: [],
        wordPattern: /[A-Za-z]+/,
      }),
    )

    open('lettersonly', '<div>hi</div>')
    editor.setSelection(4, 4)
    type('1')

    // The same keystroke in a language whose tag names take digits does mirror, so the only thing
    // deciding this is the pattern on the language.
    expect(editor.materializeFullText()).toBe('<div1>hi</div>')

    open('tsx', '<div>hi</div>')
    editor.setSelection(4, 4)
    type('1')

    expect(editor.materializeFullText()).toBe('<div1>hi</div1>')
  })
})
