import { afterEach, describe, expect, it } from 'vitest'

import { Editor } from '../src/editor/Editor'
import { createDocumentSession } from '../src/public/document'
import { resetEditorInstanceCount, setEditorSyntaxSessionFactory } from '../src/public/testing'
import { createEmptySyntaxResult } from '../src/public/syntax'
import type {
  EditorSyntaxInjection,
  EditorSyntaxResult,
  EditorSyntaxSession,
} from '../src/public/syntax'

/**
 * Proves the path the edit-action unit tests stop short of: the spans a parse hands to other grammars
 * survive the trip out of the parse and into the comment chord, so the marker the user gets is the one
 * the code under the caret writes. Everything between the parse and the document text is the real
 * Editor.
 */

const TEXT = '# T\n\n```ts\nconst a = 1\n```\n'
const CODE_OFFSET = TEXT.indexOf('const')

/** What the fence query captures: the content lines, ending where the closing fence begins. */
const FENCE: EditorSyntaxInjection = {
  parentLanguageId: 'markdown',
  languageId: 'typescript',
  startIndex: CODE_OFFSET,
  endIndex: TEXT.lastIndexOf('```'),
}

describe('commenting inside a fenced block of a real editor', () => {
  let mounted: Mounted | null = null

  afterEach(() => {
    mounted?.dispose()
    mounted = null
    setEditorSyntaxSessionFactory(undefined)
  })

  it('comments the fenced row the way the fenced language does', async () => {
    mounted = await mount([FENCE])

    expect(mounted.commentRowAt(CODE_OFFSET)).toBe('# T\n\n```ts\n// const a = 1\n```\n')
  })

  it('comments a prose row of the same document the way markdown does', async () => {
    mounted = await mount([FENCE])

    expect(mounted.commentRowAt(0)).toBe('<!-- # T -->\n\n```ts\nconst a = 1\n```\n')
  })

  // The same fixture and the same caret as the first case, differing only in what the parse reported.
  // Without it the first case could be passing on something the fixture's text alone decides.
  it('comments the fenced row as markdown when the parse reports no fence', async () => {
    mounted = await mount([])

    expect(mounted.commentRowAt(CODE_OFFSET)).toBe('# T\n\n```ts\n<!-- const a = 1 -->\n```\n')
  })
})

type Mounted = {
  /** Puts the caret on the row holding `offset`, toggles the comment, and hands back the document. */
  commentRowAt(offset: number): string
  dispose(): void
}

async function mount(injections: readonly EditorSyntaxInjection[]): Promise<Mounted> {
  resetEditorInstanceCount()
  setEditorSyntaxSessionFactory(() => injectedSyntaxSession(injections))
  const container = document.createElement('div')
  document.body.appendChild(container)
  const editor = new Editor(container)
  const session = createDocumentSession(TEXT)
  editor.attachSession(session, { documentId: 'notes.md', languageId: 'markdown' })
  // The parse lands after the attach resolves, so the injections reach the chord only once it has.
  await new Promise((resolve) => setTimeout(resolve, 160))
  await Promise.resolve()

  return {
    commentRowAt: (offset) => {
      editor.setSelection(offset, offset)
      expect(editor.dispatchCommand('editor.action.commentLine')).toBe(true)
      return session.materializeFullText()
    },
    dispose: () => {
      editor.dispose()
      container.remove()
    },
  }
}

function injectedSyntaxSession(injections: readonly EditorSyntaxInjection[]): EditorSyntaxSession {
  const result: EditorSyntaxResult = { ...createEmptySyntaxResult(), injections }
  return {
    applyChange: async () => result,
    dispose: () => undefined,
    getResult: () => result,
    foldingSupport: 'supported',
    getSnapshotVersion: () => 0,
    getTokens: () => [],
    refresh: async () => result,
  }
}
