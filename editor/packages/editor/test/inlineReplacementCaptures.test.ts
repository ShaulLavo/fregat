import { createSyntaxPlugin } from './factories/syntaxRuntime'
import type { EditorStructuralOperationContext } from '../src/document/operations'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Editor } from '../src/editor/Editor'
import { resetEditorInstanceCount } from '../src/public/testing'
import type { EditorPlugin } from '../src/plugins'
import { createEmptySyntaxResult } from '../src/syntax/session'
import type {
  EditorSyntaxCapture,
  EditorSyntaxResult,
  EditorSyntaxRuntime,
} from '../src/syntax/session'

/**
 * Captures are the only input an inline replacement provider has, and a session that was never
 * asked for them hands over an empty array no matter how well the rest of the path works — which is
 * how markdown preview rendered plain source. So the contract under test is the request itself.
 */

const TEXT = '# Title\n'
const CAPTURES: readonly EditorSyntaxCapture[] = [
  { startIndex: 0, endIndex: 1, captureName: 'punctuation.special' },
]

describe('syntax captures for inline replacement providers', () => {
  let container: HTMLElement
  let editor: Editor | null = null
  let syntaxPlugin: EditorPlugin
  let sessionOptions: EditorStructuralOperationContext[]

  beforeEach(() => {
    sessionOptions = []
    resetEditorInstanceCount()
    syntaxPlugin = createSyntaxPlugin((options) => {
      sessionOptions.push(options)
      return captureSyntaxSession(options.includeCaptures ?? false)
    })
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    editor?.dispose()
    editor = null
    container.remove()
  })

  it('leaves captures off while nothing consumes them', async () => {
    editor = new Editor(container, { plugins: [syntaxPlugin] })

    await openDocument()

    expect(sessionOptions.map((options) => options.includeCaptures ?? false)).toEqual([false])
  })

  it('requests captures for a provider registered before the document opens', async () => {
    const seen: (readonly EditorSyntaxCapture[])[] = []
    editor = new Editor(container, { plugins: [syntaxPlugin, inlineReplacementPlugin(seen)] })

    await openDocument()

    expect(sessionOptions.at(-1)?.includeCaptures).toBe(true)
    expect(seen.at(-1)).toEqual(CAPTURES)
  })

  it('reparses when a provider registers after the document opened', async () => {
    const seen: (readonly EditorSyntaxCapture[])[] = []
    editor = new Editor(container, { plugins: [syntaxPlugin] })
    await openDocument()
    expect(sessionOptions.at(-1)?.includeCaptures).toBe(false)

    editor.setInlineReplacementProvider((context) => {
      seen.push(context.captures)
      return []
    })
    await flushSyntaxDebounce()

    expect(sessionOptions.at(-1)?.includeCaptures).toBe(true)
    expect(seen.at(-1)).toEqual(CAPTURES)
  })

  it('withholds old capture offsets after an edit until a current parse lands', async () => {
    let readCaptures: () => readonly EditorSyntaxCapture[] | null = () => null
    editor = new Editor(container, {
      plugins: [
        syntaxPlugin,
        {
          name: 'test.capture-reader',
          activate: (context) =>
            context.registerViewContribution({
              createContribution: (view) => {
                readCaptures = () => view.getSyntaxCaptures()
                const captures = view.requestSyntaxCaptures()
                return { update: () => undefined, dispose: () => captures.dispose() }
              },
            }),
        },
      ],
    })
    editor.setText(TEXT, { languageId: 'markdown' })
    await flushSyntaxDebounce()
    expect(readCaptures()).toEqual(CAPTURES)

    editor.edit({ from: 0, to: 0, text: 'intro ' })
    expect(readCaptures()).toBeNull()
    await flushSyntaxDebounce()
    expect(readCaptures()).toEqual(CAPTURES)
  })

  async function openDocument(): Promise<void> {
    editor?.openDocument({ documentId: 'readme.md', languageId: 'markdown', text: TEXT })
    await flushSyntaxDebounce()
  }
})

function inlineReplacementPlugin(seen: (readonly EditorSyntaxCapture[])[]): EditorPlugin {
  return {
    name: 'test.inline-replacements',
    activate: (context) =>
      context.registerInlineReplacementProvider((replacementContext) => {
        seen.push(replacementContext.captures)
        return []
      }),
  }
}

function captureSyntaxSession(includeCaptures: boolean): EditorSyntaxRuntime {
  const result: EditorSyntaxResult = {
    ...createEmptySyntaxResult(),
    captures: includeCaptures ? CAPTURES : [],
  }
  return {
    dispose: () => undefined,
    getResult: () => result,
    foldingSupport: 'supported',
    getSnapshotVersion: () => 0,
    getTokens: () => [],
    analyze: async () => result,
  }
}

async function flushSyntaxDebounce(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 160))
  await Promise.resolve()
  await Promise.resolve()
}
