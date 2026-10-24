import { Editor } from '@singapore-editor/core/editor'
import type { SelectionAffinity } from '@singapore-editor/core/document'
import type { EditorEditContributionContext, EditorPlugin } from '@singapore-editor/core/extensions'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as lsp from 'vscode-languageserver-protocol'

import {
  COMPLETION_ACCEPT_TIMING_NAME,
  connectedEditor,
  flushPromises,
  type ConnectedEditor,
} from './connectedEditor'

/*
 * A snippet arriving the way one really does: a server answers with an item marked as a snippet,
 * the user accepts it, and the plugin has to turn what the server wrote into text that belongs in
 * this file at this caret. Nothing here calls the parser — a snippet that expands correctly and is
 * then inserted wrongly is exactly the failure this suite exists to catch.
 */

// Two spaces per level, and a caret four columns in on the third line.
const TWO_SPACE_FILE = 'function outer() {\n  if (ready) {\n    f\n  }\n}\n'
const CARET = TWO_SPACE_FILE.indexOf('    f') + 5
const TYPED_CARET = CARET + 1

/** Replaces the `fo` the caret has reached, which is what a server matching on it sends back. */
const typedWordRange: lsp.Range = {
  start: { line: 2, character: 4 },
  end: { line: 2, character: 6 },
}

async function acceptSnippet(
  newText: string,
  affinity: SelectionAffinity = 'after',
): Promise<ReturnType<typeof connectedEditor>> {
  const editor = await connectedEditor(TWO_SPACE_FILE, CARET, { affinity })

  editor.type('o')
  await vi.advanceTimersByTimeAsync(90)
  editor.answerCompletion([
    { label: 'forOf', insertTextFormat: 2, textEdit: { range: typedWordRange, newText } },
  ])
  await flushPromises()
  editor.pressKey('Enter')
  return editor
}

/**
 * The accepted snippet handed to a real editor and typed into.
 *
 * What the plugin produces is a promise about someone else's document, and the two sides meet
 * through a built package rather than through this source tree: only a keystroke arriving on the
 * far side of that seam says whether the promise is kept.
 */
function typeIntoAccepted(accepted: ConnectedEditor, characters: readonly string[]): string {
  const applied = accepted.applyEdits.mock.calls.at(-1)
  if (!applied) throw new Error('the accepted item applied no edits')

  const [edits, , selection] = applied
  const stops = accepted.startedSnippetSessions().at(-1)
  if (!stops) throw new Error('the accepted item started no snippet session')

  const contributed: { current: EditorEditContributionContext | null } = { current: null }
  const host: EditorPlugin = {
    name: 'test.snippetHost',
    activate: (context) =>
      context.registerEditContribution({
        createContribution: (edited) => {
          contributed.current = edited
          return { dispose: () => {} }
        },
      }),
  }

  const container = document.createElement('div')
  document.body.appendChild(container)
  const editor = new Editor(container, { plugins: [host] })
  // The document as the user left it: the server answered the `o` they had just typed.
  editor.openDocument({
    documentId: 'main.ts',
    languageId: 'typescript',
    text: `${TWO_SPACE_FILE.slice(0, CARET)}o${TWO_SPACE_FILE.slice(CARET)}`,
  })

  const edited = contributed.current
  if (!edited?.startSnippetSession) throw new Error('the editor offered no snippet session')

  edited.applyEdits(edits, COMPLETION_ACCEPT_TIMING_NAME, selection)
  edited.startSnippetSession(stops)
  const root = container.querySelector('.editor-virtualized')
  for (const character of characters) {
    root?.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: character,
        inputType: 'insertText',
      }),
    )
  }

  const text = editor.materializeFullText()
  editor.dispose()
  container.remove()
  return text
}

describe('accepting a snippet completion', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  // The server writes its snippet as though the file started at the caret: no indentation on the
  // first line, tabs under it. Inserted as sent, the body and the closing brace both land at
  // column zero in the middle of a block that is four columns in.
  it('re-indents the lines under the first to the caret and to the file own unit', async () => {
    vi.useFakeTimers()
    const editor = await acceptSnippet('for (const ${1:item} of ${2:items}) {\n\t$0\n}')

    expect(editor.applyEdits).toHaveBeenCalledWith(
      [{ from: 38, to: 40, text: 'for (const item of items) {\n      \n    }' }],
      COMPLETION_ACCEPT_TIMING_NAME,
      expect.any(Object),
    )
  })

  it('reports re-indented stops without losing a before-affinity caret', async () => {
    vi.useFakeTimers()
    const editor = await acceptSnippet('for (const ${1:item} of ${2:items}) {\n\t$0\n}', 'before')

    expect(editor.applyEdits).toHaveBeenCalledWith(
      expect.anything(),
      COMPLETION_ACCEPT_TIMING_NAME,
      { anchor: 49, head: 53, affinity: 'before' },
    )
    // `$0` sits past the six spaces its line now opens with, not at the column the server wrote it.
    expect(editor.startedSnippetSessions()).toEqual([
      [
        { start: 49, end: 53 },
        { start: 57, end: 62 },
        { start: 72, end: 72 },
      ],
    ])
  })

  // A transform renders a copy of a placeholder. The copy is not somewhere to put a caret, and
  // offering it as stop 1 is what left the first Tab selecting text the reader cannot edit.
  it('offers the placeholder a transform mirrors rather than the mirror', async () => {
    vi.useFakeTimers()
    const editor = await acceptSnippet('${1/(.*)/${1:/upcase}/} = ${1:name}')

    expect(editor.applyEdits).toHaveBeenCalledWith(
      [{ from: 38, to: 40, text: 'NAME = name' }],
      COMPLETION_ACCEPT_TIMING_NAME,
      { anchor: 45, head: 49, affinity: 'after' },
    )
    // The mirror travels with the stop it copies rather than being dropped, so the host can keep
    // the two reading the same while the placeholder is typed into.
    expect(editor.startedSnippetSessions()).toEqual([
      [{ start: 45, end: 49, mirrors: [{ start: 38, end: 42, transform: expect.any(Function) }] }],
    ])
  })

  it('carries a repeated stop into its copy as the accepted snippet is typed into', async () => {
    vi.useFakeTimers()
    const accepted = await acceptSnippet('const ${1:name} = $1')

    expect(typeIntoAccepted(accepted, ['s', 'u', 'm'])).toBe(
      'function outer() {\n  if (ready) {\n    const sum = sum\n  }\n}\n',
    )
  })

  it('leaves an item that is not a snippet as the literal text it was sent as', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor(TWO_SPACE_FILE, CARET)

    editor.type('o')
    await vi.advanceTimersByTimeAsync(90)
    editor.answerCompletion([
      { label: 'format', textEdit: { range: typedWordRange, newText: 'for$1' } },
    ])
    await flushPromises()
    editor.pressKey('Enter')

    expect(editor.applyEdits).toHaveBeenCalledWith(
      [{ from: 38, to: 40, text: 'for$1' }],
      COMPLETION_ACCEPT_TIMING_NAME,
      { anchor: TYPED_CARET + 3, head: TYPED_CARET + 3, affinity: 'after' },
    )
    expect(editor.startedSnippetSessions()).toEqual([])
  })
})
