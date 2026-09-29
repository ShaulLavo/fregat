import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Editor } from '../src/editor/Editor'
import { createStringTextSnapshot } from '../src/documentTextSnapshot'
import { guessedTabSize } from '../src/editor/indentationGuess'
import { createDocumentSession } from '../src/public/document'
import type { EditorPlugin, EditorViewSnapshot } from '../src/public/extensions'
import { resetEditorInstanceCount, setHighlightRegistry } from '../src/public/testing'
import { editorElement } from './editorElement'

/**
 * The element the editor listens on. `Editor.el` is private and neither the public API nor
 * src/public/testing.ts hands it back, yet these tests have to dispatch on that exact element or
 * the input pipeline never sees the event — hence the bracket access.
 */

/**
 * A file's own indentation width, driven through the keyboard and through what plugins are handed,
 * because the width is only worth deriving if the things that measure in it actually see it.
 */

const highlightsMap = new Map<string, unknown>()
const mockRegistry = {
  delete: (name: string) => highlightsMap.delete(name),
  set: (name: string, highlight: unknown) => {
    highlightsMap.set(name, highlight)
  },
}

class MockHighlight extends Set<Range> {}

/** A two-space file, with a caret marker on a line that opens a block. */
const TWO_SPACE_SOURCE = 'function f() {|\n  if (x) {\n    return 1\n  }\n}'

/**
 * Declarations aligned under the token above them, which is not nesting: the four six-space steps
 * would outvote the file's two real two-space ones if they were counted.
 */
const ALIGNED_SOURCE =
  'const a = 1,\n      b = 2\nconst c = 3,\n      d = 4\nif (a) {|\n  return b\n}'

function lineBreak(): InputEvent {
  return new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertLineBreak',
  })
}

/** Records every view snapshot published, which is how a guide contribution learns the width. */
function snapshotProbePlugin(record: (snapshot: EditorViewSnapshot) => void): EditorPlugin {
  return {
    name: 'test.tab-size-probe',
    activate: (context) =>
      context.registerViewContribution({
        createContribution: () => ({
          dispose: () => undefined,
          update: (snapshot) => record(snapshot),
        }),
      }),
  }
}

describe('indentation width read off the document', () => {
  let container: HTMLElement
  let editor: Editor
  let snapshots: EditorViewSnapshot[]

  beforeEach(() => {
    highlightsMap.clear()
    // @ts-expect-error — happy-dom has no Highlight constructor
    globalThis.Highlight = MockHighlight
    setHighlightRegistry(mockRegistry)
    resetEditorInstanceCount()
    snapshots = []
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
    setHighlightRegistry(undefined)
  })

  function mount(tabSize?: number, detectIndentation?: boolean): void {
    editor = new Editor(container, {
      plugins: [snapshotProbePlugin((snapshot) => snapshots.push(snapshot))],
      tabSize,
      detectIndentation,
    })
  }

  /** Presses Enter where `|` sits, and returns the indentation the new line was given. */
  function indentAfterEnter(source: string): string {
    const caret = source.indexOf('|')
    editor.setText(source.replace('|', ''), { languageId: 'typescript' })
    editor.setSelection(caret, caret)

    editorElement(editor).dispatchEvent(lineBreak())
    const text = editor.materializeFullText()
    return /^[ \t]*/.exec(text.slice(caret + 1))?.[0] ?? ''
  }

  function publishedTabSize(): number | undefined {
    return snapshots.at(-1)?.tabSize
  }

  it('indents a new line by the width the file is written in', () => {
    mount()

    expect(indentAfterEnter(TWO_SPACE_SOURCE)).toBe('  ')
  })

  it('lets the configured width stand over the file once detection is off', () => {
    mount(4, false)

    expect(indentAfterEnter(TWO_SPACE_SOURCE)).toBe('    ')
  })

  it('keeps detecting when the host names a width', () => {
    mount(8)

    expect(indentAfterEnter(TWO_SPACE_SOURCE)).toBe('  ')
  })

  it('takes a new width live: as the fallback, and as the width once detection is off', () => {
    mount()
    editor.setText('a\nb', { languageId: 'typescript' })
    editor.setTabSize(3)
    expect(snapshots.at(-1)?.tabSize).toBe(3)
    expect(
      container
        .querySelector<HTMLElement>('.editor-virtualized')
        ?.style.getPropertyValue('--editor-tab-size'),
    ).toBe('3')

    editor.dispose()
    mount(4, false)
    editor.setText(TWO_SPACE_SOURCE.replace('|', ''), { languageId: 'typescript' })
    editor.setTabSize(6)
    expect(snapshots.at(-1)?.tabSize).toBe(6)
  })

  it('keeps the width a file is written in when the fallback changes', () => {
    mount()
    editor.setText(TWO_SPACE_SOURCE.replace('|', ''), { languageId: 'typescript' })
    editor.setTabSize(8)

    expect(snapshots.at(-1)?.tabSize).toBe(2)
  })

  it('outdents by the width the file is written in', () => {
    mount()
    const source = TWO_SPACE_SOURCE.replace('|', '')
    editor.setText(source, { languageId: 'typescript' })
    editor.setSelection(source.indexOf('return 1'))

    expect(editor.dispatchCommand('outdentSelection')).toBe(true)
    expect(editor.materializeFullText()).toBe('function f() {\n  if (x) {\n  return 1\n  }\n}')
  })

  it('does not read spaces that align a continued declaration as nesting', () => {
    mount()

    expect(indentAfterEnter(ALIGNED_SOURCE)).toBe('  ')
  })

  it("publishes the file's width to view contributions", () => {
    mount()
    editor.setText(TWO_SPACE_SOURCE.replace('|', ''), { languageId: 'typescript' })

    expect(publishedTabSize()).toBe(2)
  })

  it('reads the width of a session attached from outside too', () => {
    mount()
    editor.attachSession(createDocumentSession(TWO_SPACE_SOURCE.replace('|', '')))

    expect(publishedTabSize()).toBe(2)
  })

  it('takes no width from a fragment that only begins indented', () => {
    mount()
    editor.setText('  if (x) {', { languageId: 'typescript' })

    expect(publishedTabSize()).toBe(4)
  })

  it('keeps the configured width for a file indented with tabs', () => {
    mount()
    editor.setText('function f() {\n\tif (x) {\n\t\treturn 1\n\t}\n}\n  aligned', {
      languageId: 'typescript',
    })

    expect(publishedTabSize()).toBe(4)
  })
})

/**
 * The same width read straight off text, for the cases where two of the rules want different answers
 * from the same lines and only one of them can have it.
 */
describe('what a document votes for', () => {
  it('samples the head of a file rather than all of it', () => {
    // One two-space step inside the sampled head, against a hundred eight-space steps past it: the
    // tail would win outright if the sample were not bounded.
    const head = ['x', '  y', ...Array.from({ length: 9_998 }, () => 'z')]
    const tail = Array.from({ length: 50 }, () => 'p\n        q')

    expect(guessedTabSize(createStringTextSnapshot(head.concat(tail).join('\n')), 4)).toBe(2)
  })

  it('reads a step under a line that does not end mid-list as nesting', () => {
    // Both lines above leave a gap at column four, where the line below puts its first token, so
    // every part of the alignment shape but its last holds for the block as much as for the list.
    expect(guessedTabSize(createStringTextSnapshot('let x = 1,\n    y = 2'), 2)).toBe(2)
    expect(guessedTabSize(createStringTextSnapshot('let f = () => {\n    body\n}'), 2)).toBe(4)
  })

  it('gives a whitespace-only line neither a vote nor a turn as the line above', () => {
    // Whitespace left behind by a deleted statement, deeper than the code around it: it would beat
    // the file's real width three votes to two on its own, and beat it again as the line the code
    // after it gets measured against.
    const text = [
      'function f() {',
      '  const a = 1',
      '      ',
      '  const b = 2',
      '      ',
      '  const c = 3',
      '      ',
      '  return a + b + c',
      '}',
    ].join('\n')

    expect(guessedTabSize(createStringTextSnapshot(text), 4)).toBe(2)
  })

  it('counts alignment whose step is exactly the width already in effect', () => {
    const text = [
      'let x = 1,',
      '    y = 2',
      'let a = 3,',
      '    b = 4',
      'if (a) {',
      '   deep',
      '}',
    ].join('\n')

    expect(guessedTabSize(createStringTextSnapshot(text), 4)).toBe(4)
    // Not a line of the text changed, only what a level is already worth: the four-space steps are
    // now alignment and nothing else, and the three-space ones are the only evidence left standing.
    expect(guessedTabSize(createStringTextSnapshot(text), 8)).toBe(3)
  })

  it('reads a fragmented document no further than its sampled head, in bounded blocks', () => {
    const head = [
      'x',
      '  y',
      ...Array.from({ length: 9_998 }, (_, index) => `${'z'.repeat(index % 40)}`),
    ]
    const tail = Array.from({ length: 2_000 }, () => 'p\n        q')
    const text = head.concat(tail).join('\n')
    const session = createDocumentSession(text.slice(0, 5_000))
    session.applyEdits([{ from: 5_000, to: 5_000, text: text.slice(5_000) }])
    const source = session.getTextSnapshot()
    const readRange = vi.spyOn(source, 'readRange')

    expect(guessedTabSize(source, 4)).toBe(guessedTabSize(createStringTextSnapshot(text), 4))
    const reads = readRange.mock.calls.map(([start, end]) => ({ start, end }))
    expect(reads.every((read) => read.end - read.start <= 16_384)).toBe(true)
    expect(Math.max(...reads.map((read) => read.end))).toBeLessThanOrEqual(
      source.lineStart(10_000) + 16_384,
    )
  })

  it('settles a tie on the even width', () => {
    // One three-space block and one four-space block, so the two widths come out of the count with
    // nothing between them and the answer rests on which was asked first.
    const text = ['if (a) {', '   b', '}', 'if (c) {', '    d', '}'].join('\n')

    expect(guessedTabSize(createStringTextSnapshot(text), 2)).toBe(4)
  })
})
