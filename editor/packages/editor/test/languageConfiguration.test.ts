import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Editor } from '../src/editor/Editor'
import {
  editorLanguageConfiguration,
  registerEditorLanguageConfiguration,
  type EditorDisposable,
  type EditorLanguageConfiguration,
} from '../src/public/extensions'
import { resetEditorInstanceCount, setHighlightRegistry } from '../src/public/testing'
import { editorElement } from './editorElement'

/**
 * The element the editor listens on. `Editor.el` is private and neither the public API nor
 * src/public/testing.ts hands it back, yet these tests have to dispatch on that exact element or
 * the input pipeline never sees the event — hence the bracket access.
 */

/**
 * Language rules driven through the keyboard: a real beforeinput line break on the editor, so what
 * is asserted is what a user gets rather than what the decision function returns. The decision
 * itself is unit-tested in src/editor/indentation.test.ts.
 */

const CODE_OPENERS = ['(', '[', '{', "'", '"', '`']
const QUOTED_OPENERS = ['(', '[', '{', "'", '"']
const PROSE_OPENERS = ['(', '[', '{', '`']

const LINE_AND_BLOCK_COMMENTS = { line: '//', block: { open: '/*', close: '*/' } }
const HTML_COMMENTS = { block: { open: '<!--', close: '-->' } }

/** Every comment opener a fold region could be marked after, of which a record accepts only its own. */
const REGION_COMMENTS = ['//', '/*', '<!--', '#']

const BRACKET_PAIRS = [
  { close: ')', open: '(' },
  { close: ']', open: '[' },
  { close: '}', open: '{' },
]

/**
 * Every language id the registry answers for, with what its record says that no other record we ship
 * says.
 *
 * A row two of our records could both satisfy would let an id drift from one to the other unnoticed,
 * which is how the table-per-feature this replaced came to disagree about which languages exist.
 */
const DESCRIBED_LANGUAGES = [
  {
    afterCommentOpener: '/**\n * ',
    afterOpenTag: '<div>\n',
    afterSwitchLabel: "case 'a':\n  ",
    comments: LINE_AND_BLOCK_COMMENTS,
    ids: ['javascript', 'ts', 'typescript'],
    listMarkers: false,
    offSide: false,
    openers: CODE_OPENERS,
    regionComment: '//',
  },
  {
    afterCommentOpener: '/**\n * ',
    afterOpenTag: '<div>\n  ',
    afterSwitchLabel: "case 'a':\n  ",
    comments: LINE_AND_BLOCK_COMMENTS,
    ids: ['javascriptreact', 'jsx', 'tsx', 'typescriptreact'],
    listMarkers: false,
    offSide: false,
    openers: CODE_OPENERS,
    regionComment: '//',
  },
  {
    afterCommentOpener: '/**\n',
    afterOpenTag: '<div>\n',
    afterSwitchLabel: "case 'a':\n",
    comments: LINE_AND_BLOCK_COMMENTS,
    ids: ['json', 'jsonc'],
    listMarkers: false,
    offSide: false,
    openers: CODE_OPENERS,
    regionComment: '//',
  },
  {
    afterCommentOpener: '/**\n * ',
    afterOpenTag: '<div>\n',
    afterSwitchLabel: "case 'a':\n",
    comments: { block: { open: '/*', close: '*/' } },
    ids: ['css'],
    listMarkers: false,
    offSide: false,
    openers: CODE_OPENERS,
    regionComment: '/*',
  },
  {
    afterCommentOpener: '/**\n * ',
    afterOpenTag: '<div>\n',
    afterSwitchLabel: "case 'a':\n",
    comments: LINE_AND_BLOCK_COMMENTS,
    ids: ['scss'],
    listMarkers: false,
    offSide: false,
    openers: CODE_OPENERS,
    regionComment: '//',
  },
  {
    afterCommentOpener: '/**\n',
    afterOpenTag: '<div>\n  ',
    afterSwitchLabel: "case 'a':\n",
    comments: HTML_COMMENTS,
    ids: ['html'],
    listMarkers: false,
    offSide: false,
    openers: CODE_OPENERS,
    regionComment: '<!--',
  },
  {
    afterCommentOpener: '/**\n',
    afterOpenTag: '<div>\n',
    afterSwitchLabel: "case 'a':\n",
    comments: HTML_COMMENTS,
    ids: ['markdown', 'md'],
    listMarkers: true,
    offSide: true,
    openers: PROSE_OPENERS,
    regionComment: '<!--',
  },
  {
    afterCommentOpener: '/**\n',
    afterOpenTag: '<div>\n',
    afterSwitchLabel: "case 'a':\n",
    comments: { line: '#' },
    ids: ['python', 'yaml', 'yml'],
    listMarkers: false,
    offSide: true,
    openers: QUOTED_OPENERS,
    regionComment: '#',
  },
]

function regionComments(configuration: EditorLanguageConfiguration | null): readonly string[] {
  return REGION_COMMENTS.filter((comment) =>
    configuration?.folding?.regionMarkers.openers.includes(comment),
  )
}

const highlightsMap = new Map<string, unknown>()
const mockRegistry = {
  delete: (name: string) => highlightsMap.delete(name),
  set: (name: string, highlight: unknown) => {
    highlightsMap.set(name, highlight)
  },
}

class MockHighlight extends Set<Range> {}

function lineBreak(): InputEvent {
  return new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertLineBreak',
  })
}

describe('language configuration', () => {
  let container: HTMLElement
  let editor: Editor
  const registrations: EditorDisposable[] = []

  beforeEach(() => {
    highlightsMap.clear()
    // @ts-expect-error — happy-dom has no Highlight constructor
    globalThis.Highlight = MockHighlight
    setHighlightRegistry(mockRegistry)
    resetEditorInstanceCount()
    container = document.createElement('div')
    document.body.appendChild(container)
    editor = new Editor(container, { tabSize: 2 })
  })

  afterEach(() => {
    while (registrations.length > 0) registrations.pop()?.dispose()
    editor.dispose()
    container.remove()
    setHighlightRegistry(undefined)
  })

  /** Puts the caret where `|` sits and presses Enter, returning the whole document. */
  function pressEnter(source: string, languageId: string): string {
    const caret = source.indexOf('|')
    editor.setText(source.replace('|', ''), { languageId })
    editor.setSelection(caret, caret)

    editorElement(editor).dispatchEvent(lineBreak())
    return editor.materializeFullText()
  }

  it.each(DESCRIBED_LANGUAGES)('describes $ids and nothing else the same way', (expected) => {
    for (const languageId of expected.ids) {
      const configuration = editorLanguageConfiguration(languageId)

      expect(configuration?.comments, languageId).toEqual(expected.comments)
      expect(
        configuration?.autoClosingPairs.map((pair) => pair.open),
        languageId,
      ).toEqual(expected.openers)
      // A delimiter that opens a block is not a matter of taste, so every record we ship agrees here.
      expect(configuration?.brackets, languageId).toEqual(BRACKET_PAIRS)
      expect(configuration?.listMarkers === true, languageId).toBe(expected.listMarkers)
      expect(configuration?.folding?.offSide, languageId).toBe(expected.offSide)
      expect(regionComments(configuration), languageId).toEqual([expected.regionComment])
      // Three line breaks, one per rule set a record can carry: the line-shape rules that see a
      // switch label, the tag rules, and the comment rules that lay down a leader.
      expect(pressEnter("case 'a':|", languageId), languageId).toBe(expected.afterSwitchLabel)
      expect(pressEnter('<div>|', languageId), languageId).toBe(expected.afterOpenTag)
      expect(pressEnter('/**|', languageId), languageId).toBe(expected.afterCommentOpener)
    }
  })

  it('has nothing to say about a language nobody registered', () => {
    expect(editorLanguageConfiguration('cobol')).toBeNull()
    expect(editorLanguageConfiguration(null)).toBeNull()
    expect(editorLanguageConfiguration('  ')).toBeNull()
  })

  it('auto-closes for a language id that arrives with host casing', () => {
    editor.setText('', { languageId: 'TypeScript' })
    editor.setSelection(0, 0)

    editorElement(editor).dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: '(',
        inputType: 'insertText',
      }),
    )

    expect(editor.materializeFullText()).toBe('()')
  })

  // The one thing the keyboard adds over the decision function: text a rule pushes *past* the caret
  // has to survive the input path and land on its own line.
  it('opens a block comment leader and pushes its closer down', () => {
    expect(pressEnter('/**| */', 'typescript')).toBe('/**\n * \n */')
  })

  // The registration seam is only real if a language nothing in this repo knows about can reach the
  // same three-tier decision as a built-in one.
  it('honours a language registered through the public API', () => {
    registrations.push(
      registerEditorLanguageConfiguration('fauxml', {
        autoClosingPairs: [],
        brackets: [{ close: 'end', open: 'do' }],
        onEnterRules: [{ action: { appendText: '# ', indentAction: 'none' }, beforeText: /^\s*#/ }],
      }),
    )

    expect(pressEnter('  loop do|', 'fauxml')).toBe('  loop do\n    ')
    expect(pressEnter('  loop do|end', 'fauxml')).toBe('  loop do\n    \n  end')
    expect(pressEnter('  # note|', 'fauxml')).toBe('  # note\n  # ')
  })
})
