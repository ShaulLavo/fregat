import { detectPlatform } from '@tanstack/hotkeys'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createStringTextSnapshot } from '../src/documentTextSnapshot'
import type { EditorCommandId } from '../src/editor/commands'
import {
  documentSelectionEditForCommand,
  isEditorDocumentSelectionEditCommand,
  reindentEditsForRanges,
  type EditorDocumentSelectionEditCommandId,
} from '../src/editor/reindent'
import type { TextEdit } from '../src/tokens'
import { Editor } from '../src/editor/Editor'
import {
  defaultEditorKeyBindings,
  defaultEditorKeymapLayers,
  editorCommandPackForCommand,
  filterEditorKeymapLayersByCommandPacks,
  readonlySafeEditorCommandPacks,
} from '../src/editor/keymap'
import { registerEditorLanguageConfiguration } from '../src/editor/languageConfiguration'
import { resetEditorInstanceCount, setHighlightRegistry } from '../src/public/testing'
import type { ResolvedSelection } from '../src/selections'
import { editorElement } from './editorElement'

/**
 * The element the editor listens on. `Editor.el` is private and neither the public API nor
 * src/public/testing.ts hands it back, yet these tests have to dispatch on that exact element or
 * the input pipeline never sees the event — hence the bracket access.
 */

/**
 * Reindent driven the way it is reached: the chord, the command router and the piece table. The rows
 * are deliberately written wrong and the assertion is the document afterwards, so an implementation
 * that computes the right levels but reaches no row still fails.
 */

const REINDENT_COMMAND_IDS = [
  'editor.action.reindentlines',
  'editor.action.reindentselectedlines',
] as const satisfies readonly EditorCommandId[]

type Chord = {
  readonly mod?: boolean
  readonly alt?: boolean
  readonly shift?: boolean
}

const SELECTION_CHORD: Chord = { alt: true, shift: true }
const DOCUMENT_CHORD: Chord = { mod: true, alt: true, shift: true }

const lines = (...rows: readonly string[]): string => rows.join('\n')

/** A block whose every inner row is at the wrong depth, nested so one level is not enough. */
const MESSY = lines('function outer() {', 'if (ready) {', 'run()', '}', '}')
const TIDY = lines('function outer() {', '  if (ready) {', '    run()', '  }', '}')

const highlightsMap = new Map<string, unknown>()
const mockRegistry = {
  delete: (name: string) => highlightsMap.delete(name),
  set: (name: string, highlight: unknown) => {
    highlightsMap.set(name, highlight)
  },
}

class MockHighlight extends Set<Range> {}

/**
 * Presses a chord as written here rather than whichever one the keymap currently carries, so a
 * command that moves to another key stops arriving instead of being followed to where it went.
 */
function pressOn(editor: Editor, keyName: string, chord: Chord): void {
  const mac = detectPlatform() === 'mac'

  editorElement(editor).dispatchEvent(
    new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: keyName,
      altKey: chord.alt === true,
      ctrlKey: chord.mod === true && !mac,
      metaKey: chord.mod === true && mac,
      shiftKey: chord.shift === true,
    }),
  )
}

/** The commands a host still binds once it has narrowed the keymap for a document nobody may edit. */
function readonlyCommands(platform: 'mac' | 'windows' | 'linux'): readonly EditorCommandId[] {
  return filterEditorKeymapLayersByCommandPacks(
    defaultEditorKeymapLayers(platform),
    readonlySafeEditorCommandPacks,
  ).flatMap((layer) => layer.bindings.map((binding) => binding.command))
}

describe('reindent command wiring', () => {
  // A pack is what carries a binding into a layer and the dispatch predicate is what routes the id,
  // so a command missing from either is one no keystroke reaches.
  it.each(REINDENT_COMMAND_IDS)('gives %s a pack, a chord and a route', (command) => {
    expect(editorCommandPackForCommand(command)).toBe('advanced-editing')
    expect(isEditorDocumentSelectionEditCommand(command)).toBe(true)

    for (const platform of ['mac', 'windows', 'linux'] as const) {
      expect(defaultEditorKeyBindings(platform).map((binding) => binding.command)).toContain(
        command,
      )
      // Rewriting indentation is an edit, so narrowing a keymap to what a reader may press drops it.
      expect(readonlyCommands(platform)).not.toContain(command)
    }
  })
})

describe('reindent from the keyboard', () => {
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
    // Named so the width cannot be taken from whichever fixture is open.
    editor = new Editor(container, { tabSize: 2 })
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
    setHighlightRegistry(undefined)
  })

  function open(text: string): void {
    editor.openDocument({ documentId: 'main.ts', languageId: 'typescript', text })
  }

  function press(keyName: string, chord: Chord): void {
    pressOn(editor, keyName, chord)
  }

  function selectAll(text: string): void {
    editor.setSelection(0, text.length)
  }

  it('rebuilds the selected rows from the language rules', () => {
    open(MESSY)
    selectAll(MESSY)

    press('I', SELECTION_CHORD)

    expect(editor.materializeFullText()).toBe(TIDY)
  })

  it('steps by the width the editor was opened with', () => {
    const wideContainer = document.body.appendChild(document.createElement('div'))
    const wideEditor = new Editor(wideContainer, { tabSize: 4 })

    try {
      wideEditor.openDocument({ documentId: 'wide.ts', languageId: 'typescript', text: MESSY })
      wideEditor.setSelection(0, MESSY.length)

      pressOn(wideEditor, 'I', SELECTION_CHORD)

      expect(wideEditor.materializeFullText()).toBe(
        lines('function outer() {', '    if (ready) {', '        run()', '    }', '}'),
      )
    } finally {
      wideEditor.dispose()
      wideContainer.remove()
    }
  })

  it('reindents the whole document from a caret that selects nothing', () => {
    open(MESSY)
    editor.setSelection(0)

    // The selection command has no rows to work on: the caret is on the first row, and the row a
    // range is measured from is the one above the first it rewrites.
    press('I', SELECTION_CHORD)
    expect(editor.materializeFullText()).toBe(MESSY)

    press('I', DOCUMENT_CHORD)
    expect(editor.materializeFullText()).toBe(TIDY)
  })

  it('keeps a tabbed file tabbed', () => {
    const tabbed = lines('function outer() {', '\t\trun()', '}')
    open(tabbed)
    selectAll(tabbed)

    press('I', SELECTION_CHORD)

    expect(editor.materializeFullText()).toBe(lines('function outer() {', '\trun()', '}'))
  })

  it('keeps a spaced file spaced when one row arrived from somewhere else tabbed', () => {
    const mostlySpaced = lines(
      'function outer() {',
      '  const x = 1',
      '  if (ready) {',
      '\trun()',
      '  }',
      '  return x',
      '}',
    )
    open(mostlySpaced)
    selectAll(mostlySpaced)

    press('I', SELECTION_CHORD)

    expect(editor.materializeFullText()).toBe(
      lines(
        'function outer() {',
        '  const x = 1',
        '  if (ready) {',
        '    run()',
        '  }',
        '  return x',
        '}',
      ),
    )
  })

  it('reads an opener whose line ends in a comment that quotes an apostrophe', () => {
    const text = lines('function outer() {', "if (ready) { // don't stop", 'run()', '}', '}')
    open(text)
    selectAll(text)

    press('I', SELECTION_CHORD)

    expect(editor.materializeFullText()).toBe(
      lines('function outer() {', "  if (ready) { // don't stop", '    run()', '  }', '}'),
    )
  })

  it('leaves a template literal spanning rows exactly as it is', () => {
    // The braces belong to the string, not to the code, and the rows they sit on
    // are the string's own content.
    const text = lines(
      'function outer() {',
      'const sql = `',
      '  SELECT {',
      '    one',
      '  }',
      '`',
      'run()',
      '}',
    )
    open(text)
    selectAll(text)

    press('I', SELECTION_CHORD)

    expect(editor.materializeFullText()).toBe(
      lines(
        'function outer() {',
        '  const sql = `',
        '  SELECT {',
        '    one',
        '  }',
        '`',
        '  run()',
        '}',
      ),
    )
  })

  it('stops an unclosed delimiter at its own line', () => {
    // An apostrophe is more often prose than a literal, so one that never closes
    // must not mask the rest of the file.
    const text = lines('function outer() {', "const it = 'don", 'run()', '}')
    open(text)
    selectAll(text)

    press('I', SELECTION_CHORD)

    expect(editor.materializeFullText()).toBe(
      lines('function outer() {', "  const it = 'don", '  run()', '}'),
    )
  })

  it('does not let a delimiter inside a comment open a block', () => {
    const text = lines('function outer() {', 'run(); /* { */', 'after()', '}')
    open(text)
    selectAll(text)

    press('I', SELECTION_CHORD)

    expect(editor.materializeFullText()).toBe(
      lines('function outer() {', '  run(); /* { */', '  after()', '}'),
    )
  })

  it('does not let a closer inside a comment close a block', () => {
    const text = lines('function outer() {', '/*', '} not code', '*/', 'after()', '}')
    open(text)
    selectAll(text)

    press('I', SELECTION_CHORD)

    // The rows inside the comment are content: they keep their own columns, and the row after the
    // comment is still one level in.
    expect(editor.materializeFullText()).toBe(
      lines('function outer() {', '  /*', '} not code', '*/', '  after()', '}'),
    )
  })

  it('leaves a documented function exactly as it is', () => {
    const documented = lines(
      'function outer() {',
      '  /**',
      '   * Documented.',
      '   */',
      '  run()',
      '}',
    )
    open(documented)
    selectAll(documented)

    press('I', SELECTION_CHORD)

    expect(editor.materializeFullText()).toBe(documented)
  })
})

/** A resolved selection over [start, end); collapsed when they match. */
function selection(start: number, end = start): ResolvedSelection {
  return {
    anchorOffset: start,
    collapsed: start === end,
    endOffset: end,
    headOffset: end,
    id: `sel:${start}:${end}`,
    reversed: false,
    startOffset: start,
  } as ResolvedSelection
}

function applyEdits(text: string, edits: readonly TextEdit[]): string {
  let out = text
  for (const edit of [...edits].sort((left, right) => right.from - left.from)) {
    out = out.slice(0, edit.from) + edit.text + out.slice(edit.to)
  }

  return out
}

function run(
  command: EditorDocumentSelectionEditCommandId,
  text: string,
  languageId: string,
): string {
  return applyEdits(
    text,
    documentSelectionEditForCommand(
      command,
      createStringTextSnapshot(text),
      [selection(0, text.length)],
      {
        languageId,
        tabSize: 2,
      },
    ).edits,
  )
}

describe('reindent asked for by offset', () => {
  // Two inner rows equally wrong, so a range reaching one of them and not the other is visible in
  // the document rather than only in the edit list.
  const NESTED = lines('function outer() {', 'if (ready) {', 'run()', 'more()', '}', '}')

  const reindented = (start: number, end: number): string =>
    applyEdits(
      NESTED,
      reindentEditsForRanges(NESTED, [{ end, start }], { languageId: 'typescript', tabSize: 2 }),
    )

  it('leaves every row the offsets did not ask about', () => {
    expect(reindented(32, 32)).toBe(
      lines('function outer() {', 'if (ready) {', '  run()', 'more()', '}', '}'),
    )
  })

  it('reaches the last row a range spans and not only its first', () => {
    expect(reindented(32, 44)).toBe(
      lines('function outer() {', 'if (ready) {', '  run()', '  more()', '}', '}'),
    )
  })
})

describe('reindent measured across rows the rules skip', () => {
  // The row above is what a range is measured from, and a blank one says nothing about a level. The
  // shapes here are the ones an editor hands over by itself: a closer typed under a blank row, and a
  // selection that starts one.
  it('corrects a closer typed under a blank row', () => {
    const text = lines('function f() {', '    return 1', '', '    }')

    expect(
      applyEdits(
        text,
        reindentEditsForRanges(text, [{ end: text.length, start: text.length }], {
          languageId: 'typescript',
          tabSize: 4,
        }),
      ),
    ).toBe(lines('function f() {', '    return 1', '', '}'))
  })

  it('measures a selection whose first row is blank from the row above it', () => {
    const text = lines('function f() {', '', 'return 1', 'return 2', '}', '')
    const start = text.indexOf('return 1')

    expect(
      applyEdits(
        text,
        reindentEditsForRanges(text, [{ end: start + 'return 1\nreturn 2'.length, start }], {
          languageId: 'typescript',
          tabSize: 2,
        }),
      ),
    ).toBe(lines('function f() {', '', '  return 1', '  return 2', '}', ''))
  })

  // Nothing above to look at, so the range has to fall back to the first ruled row inside it.
  it('reindents a document that opens with a blank row', () => {
    const text = lines('', 'function f() {', 'run()', '}')

    expect(run('editor.action.reindentlines', text, 'typescript')).toBe(
      lines('', 'function f() {', '  run()', '}'),
    )
  })
})

describe('reindent and a switch label', () => {
  // Prettier wraps a long value onto its own row, leaving a property name alone with its colon. A
  // switch label read out of the middle of `lowercase` would open a block there and push the rest of
  // the object one level deeper.
  const WRAPPED = lines('const x = {', '  lowercase:', '    "a",', '  b: 1,', '}')

  it('does not carry the rows after a wrapped property a level deeper', () => {
    // The wrapped value lands on the object's own level, which is as far as a rule reading one line
    // at a time can see — nothing marks a continuation. What a label read out of `lowercase` would
    // do is worse and further-reaching: every row under it, the object's closer included, deepens.
    expect(run('editor.action.reindentlines', WRAPPED, 'typescript')).toBe(
      lines('const x = {', '  lowercase:', '  "a",', '  b: 1,', '}'),
    )
  })

  it('still opens a block under a label of its own', () => {
    // A label both closes the previous one and opens its own body, so it keeps the column its
    // `switch` has and only the statements under it move.
    const text = lines('switch (x) {', "case 'a':", 'run()', 'break', '}')

    expect(run('editor.action.reindentlines', text, 'typescript')).toBe(
      lines('switch (x) {', "case 'a':", '  run()', '  break', '}'),
    )
  })
})

describe('reindent and the language registry', () => {
  it('does nothing for a language that described no indentation rules', () => {
    // Braces a code language would indent on: the text has to be one that any
    // rule set would move, or the guard passes because nothing was going to
    // happen anyway.
    const text = lines('- one (', 'nested', '- two')

    expect(run('editor.action.reindentlines', text, 'markdown')).toBe(text)
    expect(run('editor.action.reindentlines', text, 'typescript')).not.toBe(text)
  })

  it('makes a block consistent where it stands rather than moving it', () => {
    // A fragment pasted in one indentation deeper: the rows inside it are made
    // consistent with its own first row, not dragged out to the margin.
    const text = lines('    function f() {', 'run()', '}')

    expect(run('editor.action.reindentlines', text, 'typescript')).toBe(
      lines('    function f() {', '      run()', '    }'),
    )
  })

  it('leaves the rows a language exempted where they are', () => {
    const registration = registerEditorLanguageConfiguration('reindent-exempt', {
      autoClosingPairs: [],
      brackets: [{ close: '}', open: '{' }],
      indentationRules: {
        decreaseIndentPattern: /^\s*\}/,
        increaseIndentPattern: /\{\s*$/,
        unIndentedLinePattern: /^\s*@/,
      },
    })

    try {
      const text = lines('outer {', '@pinned', 'body', '}')

      expect(run('editor.action.reindentlines', text, 'reindent-exempt')).toBe(
        lines('outer {', '@pinned', '  body', '}'),
      )
    } finally {
      registration.dispose()
    }
  })
})
