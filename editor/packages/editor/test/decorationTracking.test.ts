import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Editor } from '../src/editor'
import { createDocumentSession } from '../src/public/document'
import { resetEditorInstanceCount } from '../src/public/testing'
import type { EditorDecorationStore } from '../src/editor/decorationStore'
import type { EditorPlugin } from '../src/public/extensions'

/**
 * A contribution states where a decoration is once. Everything after that is the
 * editor's job: the whole point of registering rather than re-supplying is that
 * the owner never has to hear about an edit to stay correct.
 */
function createRegisteringPlugin(captured: { store: EditorDecorationStore | null }): EditorPlugin {
  return {
    activate: (context) =>
      context.registerDecorationContribution({
        createContribution: (decorationContext) => {
          captured.store = decorationContext.decorations
          decorationContext.decorations.add({
            owner: 'tracking-test',
            start: 6,
            end: 11,
            text: { className: 'marked' },
          })
          return { dispose: () => undefined }
        },
      }),
  }
}

describe('decoration tracking', () => {
  let container: HTMLElement
  let editor: Editor
  const captured: { store: EditorDecorationStore | null } = { store: null }

  beforeEach(() => {
    captured.store = null
    resetEditorInstanceCount()
    container = document.createElement('div')
    document.body.appendChild(container)
    editor = new Editor(container, {
      defaultText: 'alpha world gamma',
      plugins: [createRegisteringPlugin(captured)],
    })
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
  })

  it('carries a registered decoration through edits its owner never hears about', () => {
    const store = captured.store!
    const marked = () => store.decorationsInRange('text', 0, 1_000).map((d) => [d.start, d.end])

    expect(marked()).toEqual([[6, 11]])

    // Before it: the decoration slides by what was inserted.
    editor.edit({ from: 0, to: 0, text: '>> ' })
    expect(marked()).toEqual([[9, 14]])

    // Inside it: it grows around the text that landed within.
    editor.edit({ from: 11, to: 11, text: 'XY' })
    expect(marked()).toEqual([[9, 16]])

    // After it: nothing moves.
    const end = editor.materializeFullText().length
    editor.edit({ from: end, to: end, text: '!' })
    expect(marked()).toEqual([[9, 16]])

    expect(editor.materializeFullText()).toBe('>> alpha woXYrld gamma!')
  })

  it('carries it through this pass before a listener edit opens the next one', () => {
    // The host edits from `onChange`, so a second pass opens and closes while the first is still
    // reporting itself. The decoration has to be carried by the two edits in the order the document
    // took them; the arrangement above reaches [9, 16] the same way and is the control for this.
    editor.dispose()
    let reentrant = false
    editor = new Editor(container, {
      defaultText: 'alpha world gamma',
      plugins: [createRegisteringPlugin(captured)],
      onChange: () => {
        if (!reentrant) return

        reentrant = false
        editor.edit({ from: 0, to: 0, text: '>> ' })
      },
    })
    const store = captured.store!

    reentrant = true
    editor.edit({ from: 8, to: 8, text: 'XY' })

    expect(editor.materializeFullText()).toBe('>> alpha woXYrld gamma')
    expect(store.decorationsInRange('text', 0, 1_000).map((d) => [d.start, d.end])).toEqual([
      [9, 16],
    ])
  })

  it('drops a decoration whose text was deleted out from under it', () => {
    const store = captured.store!

    editor.edit({ from: 6, to: 11, text: '' })

    expect(store.decorationsInRange('text', 0, 1_000)).toEqual([])
  })

  // A swap is not an edit, so nothing carries a range across it. The offsets an owner registered
  // were measured in text that is gone, and reading them against the text that replaced it points
  // at unrelated characters — or past the end of a shorter document entirely.
  it('drops decorations measured in the document that was replaced', () => {
    const store = captured.store!
    expect(store.decorationsInRange('text', 0, 1_000).map((d) => [d.start, d.end])).toEqual([
      [6, 11],
    ])

    editor.setText('hi')

    expect(store.decorationsInRange('text', 0, 1_000)).toEqual([])
    // And the stale range is not merely out of view: an edit into the new document would otherwise
    // carry it further along a document it never described.
    editor.edit({ from: 0, to: 0, text: 'XY' })
    expect(store.decorationsInRange('text', 0, 1_000)).toEqual([])
  })

  it('drops them when another document is opened over the one they describe', () => {
    const store = captured.store!

    editor.openDocument({ documentId: 'other.ts', text: 'zzz' })

    expect(store.decorationsInRange('text', 0, 1_000)).toEqual([])
  })

  it('drops them when a host hands over a session of its own', () => {
    const store = captured.store!

    editor.attachSession(createDocumentSession('zzz'))

    expect(store.decorationsInRange('text', 0, 1_000)).toEqual([])
  })

  it('drops them when the document is cleared', () => {
    const store = captured.store!

    editor.clear()

    expect(store.decorationsInRange('text', 0, 1_000)).toEqual([])
  })

  it('leaves an owner restating on the swap holding one range, not one per document', () => {
    editor.dispose()
    const restating: { store: EditorDecorationStore | null } = { store: null }
    editor = new Editor(container, {
      plugins: [createRestatingPlugin(restating)],
    })
    const store = restating.store!

    editor.setText('alpha world gamma')
    expect(store.decorationsInRange('text', 0, 1_000).map((d) => [d.start, d.end])).toEqual([
      [6, 11],
    ])

    editor.setText('one world two')

    // The owner is told the document changed and registers where `world` is now. What it registered
    // against the document before it is the editor's to forget, or an editor walked through a
    // hundred files ends up holding a hundred ranges for one word.
    expect(store.decorationsInRange('text', 0, 1_000).map((d) => [d.start, d.end])).toEqual([
      [4, 9],
    ])
  })
})

/** An owner that marks the word `world` in whatever document it is handed, and then forgets it. */
function createRestatingPlugin(captured: { store: EditorDecorationStore | null }): EditorPlugin {
  return {
    activate: (context) =>
      context.registerDecorationContribution({
        createContribution: (decorationContext) => {
          captured.store = decorationContext.decorations
          return {
            dispose: () => undefined,
            handleEditorChange: () => {
              const at = decorationContext.materializeFullText().indexOf('world')
              if (at < 0) return

              decorationContext.decorations.add({
                owner: 'restating-test',
                start: at,
                end: at + 5,
                text: { className: 'marked' },
              })
            },
          }
        },
      }),
  }
}
