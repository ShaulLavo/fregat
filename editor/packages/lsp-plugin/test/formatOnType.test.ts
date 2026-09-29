import { Editor } from '@singapore-editor/core/editor'
import {
  registerEditorLanguageConfiguration,
  type EditorDisposable,
  type EditorPlugin,
  type EditorViewContributionContext,
} from '@singapore-editor/core/extensions'
import { resetEditorInstanceCount, setHighlightRegistry } from '@singapore-editor/core/testing'
import type { LspManagedTransport, LspTransportHandler } from '@singapore-editor/lsp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createLanguageServerAdapterPlugin } from '../src/plugin'

/*
 * On-type reindent driven end to end: a real editor, the real plugin, and real `beforeinput`
 * events. The point of the suite is the wiring — that a keystroke reaches the rules and that the
 * answer survives the trip back — so nothing here stands in for the editor.
 */

class MockHighlight extends Set<Range> {}

/** The plugin insists on a connection; nothing in this suite needs one to answer. */
class SilentTransport implements LspManagedTransport {
  private readonly handlers = new Set<LspTransportHandler>()

  public send(): void {}

  public subscribe(handler: LspTransportHandler): void {
    this.handlers.add(handler)
  }

  public unsubscribe(handler: LspTransportHandler): void {
    this.handlers.delete(handler)
  }

  public onDidClose(): () => void {
    return () => undefined
  }

  public close(): void {
    this.handlers.clear()
  }
}

/**
 * The element the editor listens for input on, taken from the same context the plugin is handed.
 *
 * Asking a contribution for it is how a plugin reaches the editor's input surface, so the events
 * this suite dispatches land exactly where a user's would.
 */
function inputSurfacePlugin(): { plugin: EditorPlugin; element(): HTMLElement } {
  let captured: HTMLElement | null = null

  return {
    element: () => {
      if (!captured) throw new Error('the editor never offered an input surface')
      return captured
    },
    plugin: {
      name: 'editor.test-input-surface',
      activate: (context) => [
        context.registerViewContribution({
          createContribution: (contributionContext: EditorViewContributionContext) => {
            captured = contributionContext.scrollElement
            return { update: () => undefined, dispose: () => undefined }
          },
        }),
      ],
    },
  }
}

/**
 * A contribution that edits while a change is being announced.
 *
 * That is how a document moves without every contribution hearing about it: the pass the edit opens
 * from inside the announcement is not announced a second time.
 */
function reentrantEditPlugin(): {
  plugin: EditorPlugin
  onNextContentChange(run: () => void): void
} {
  let armed: (() => void) | null = null

  return {
    onNextContentChange: (run) => {
      armed = run
    },
    plugin: {
      name: 'editor.test-reentrant-edit',
      activate: (context) => [
        context.registerViewContribution({
          createContribution: () => ({
            dispose: () => undefined,
            update: (_snapshot, kind) => {
              if (kind !== 'content' || !armed) return

              const run = armed
              armed = null
              run()
            },
          }),
        }),
      ],
    },
  }
}

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('format on type', () => {
  let container: HTMLElement
  let editor: Editor
  let surface: ReturnType<typeof inputSurfacePlugin>
  let reentrant: ReturnType<typeof reentrantEditPlugin>
  let registrations: EditorDisposable[]

  const mount = (options: { formatOnType?: boolean } = {}): void => {
    surface = inputSurfacePlugin()
    reentrant = reentrantEditPlugin()
    editor = new Editor(container, {
      // The reindent is computed while the plugin is updated and applied a turn later, so a probe
      // registered behind it edits in exactly the window the guards are about.
      plugins: [
        surface.plugin,
        createLanguageServerAdapterPlugin({
          name: 'editor.test-lsp',
          createTransport: () => new SilentTransport(),
          formatOnType: options.formatOnType,
        }),
        reentrant.plugin,
      ],
    })
  }

  const open = (languageId: string, text: string, caretOffset = text.length): void => {
    editor.openDocument({ documentId: `main.${languageId}`, languageId, text })
    editor.setSelection(caretOffset, caretOffset)
  }

  const type = (character: string): void => {
    surface.element().dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: character,
        inputType: 'insertText',
      }),
    )
  }

  const pressEnter = (): void => {
    surface.element().dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertLineBreak',
      }),
    )
  }

  beforeEach(() => {
    registrations = []
    // @ts-expect-error — happy-dom has no Highlight constructor
    globalThis.Highlight = MockHighlight
    setHighlightRegistry({ delete: () => true, set: () => undefined })
    resetEditorInstanceCount()
    container = document.createElement('div')
    document.body.appendChild(container)
    mount()
  })

  afterEach(() => {
    for (const registration of registrations) registration.dispose()
    editor.dispose()
    container.remove()
    setHighlightRegistry(undefined)
  })

  it('dedents the row a closing brace was typed on', async () => {
    open('typescript', 'function f() {\n    return 1')
    pressEnter()

    type('}')
    await flushMicrotasks()

    expect(editor.materializeFullText()).toBe('function f() {\n    return 1\n}')
  })

  it('leaves the caret after the delimiter it moved', async () => {
    open('typescript', 'function f() {\n    return 1')
    pressEnter()

    type('}')
    await flushMicrotasks()

    expect(editor.getState().cursor).toMatchObject({ column: 1, row: 2 })
  })

  it('ignores a character the language does not close a block with', async () => {
    open('typescript', 'function f() {\n    return 1\n            ')

    type('y')
    await flushMicrotasks()

    expect(editor.materializeFullText()).toBe('function f() {\n    return 1\n            y')
  })

  it('reindents on a closer the language does list', async () => {
    open('typescript', 'function f() {\n    return 1\n            ')

    type(')')
    await flushMicrotasks()

    expect(editor.materializeFullText()).toBe('function f() {\n    return 1\n)')
  })

  it('leaves a row whose delimiter is not the first thing on it', async () => {
    open('typescript', 'function f() {\n    return 1\n            x')

    type('}')
    await flushMicrotasks()

    expect(editor.materializeFullText()).toBe('function f() {\n    return 1\n            x}')
  })

  it('takes the trigger from a registered language, on the keystroke that finishes its closer', async () => {
    registrations.push(
      registerEditorLanguageConfiguration('block-language', {
        autoClosingPairs: [],
        brackets: [{ close: 'end', open: 'do' }],
        indentationRules: {
          decreaseIndentPattern: /^\s*end\b/,
          increaseIndentPattern: /\bdo\s*$/,
        },
      }),
    )
    open('block-language', 'run do\n    step\n    en')

    type('d')
    await flushMicrotasks()

    expect(editor.materializeFullText()).toBe('run do\n    step\nend')
  })

  /*
   * The inserted row leaves the same four spaces sitting at the offsets the edit was measured at, so
   * the text under it still looks untouched — only where the edit landed relative to the caret says
   * that it is now describing the wrong row.
   */
  it('throws the edit away when something reaches the text before the caret', async () => {
    open('typescript', 'function f() {\n    return 1\n    ')

    type('}')
    editor.edit({ from: 28, text: '    \n', to: 28 })
    await flushMicrotasks()

    expect(editor.materializeFullText()).toBe('function f() {\n    return 1\n    \n    }')
  })

  /*
   * The row above is widened far enough that its own indentation now covers the offsets the edit was
   * measured at, so the range still reads back as the whitespace run it was taken from. Nothing about
   * the text says the answer has gone stale; only counting the edits does.
   */
  it('will not write into text that moved without the move being announced', async () => {
    open('typescript', 'function f() {\n    return 1\n    ')
    reentrant.onNextContentChange(() => editor.edit({ from: 15, text: ' '.repeat(13), to: 15 }))

    type('}')
    await flushMicrotasks()

    expect(editor.materializeFullText()).toBe(`function f() {\n${' '.repeat(17)}return 1\n    }`)
  })

  it('still reindents when the edit that landed is past the caret', async () => {
    open('typescript', 'function f() {\n    return 1\n    \nzz', 32)

    type('}')
    editor.edit({ from: 36, text: '!', to: 36 })
    await flushMicrotasks()

    expect(editor.materializeFullText()).toBe('function f() {\n    return 1\n}\nzz!')
  })

  it('does nothing at all when the host switches it off', async () => {
    editor.dispose()
    mount({ formatOnType: false })
    open('typescript', 'function f() {\n    return 1\n    ')

    type('}')
    await flushMicrotasks()

    expect(editor.materializeFullText()).toBe('function f() {\n    return 1\n    }')
  })
})
