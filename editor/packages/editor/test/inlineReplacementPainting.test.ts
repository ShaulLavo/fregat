import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Editor } from '../src/editor/Editor'
import { createVisibleEditor } from './factories/visibleEditor'
import {
  resetEditorInstanceCount,
  setEditorSyntaxSessionFactory,
  setHighlightRegistry,
} from '../src/public/testing'
import type { EditorPlugin } from '../src/plugins'
import { EditorTokenStore } from '../src/syntax/tokenStore'

/**
 * Token ranges arrive in buffer offsets while replaced rows render display text. The chunk reuse
 * path used to store `startOffset + text.length` as the chunk's buffer end, which clipped every
 * token to the display length before the boundary math mapped it — heading colors stopped short by
 * exactly the hidden marker width.
 */

const TEXT = '## Summary\nplain\n'
const TOKEN_STYLE = { color: '#ff0000' }
const HEADING_TOKENS = [{ start: 0, end: 10, style: TOKEN_STYLE }]

let tokens: typeof HEADING_TOKENS = HEADING_TOKENS

const highlightsMap = new Map<string, Set<AbstractRange>>()
const mockRegistry = {
  delete: (name: string) => highlightsMap.delete(name),
  set: (name: string, highlight: Set<AbstractRange>) => {
    highlightsMap.set(name, highlight)
  },
}

class MockHighlight extends Set<AbstractRange> {}

describe('token painting over inline replacements', () => {
  let container: HTMLElement
  let editor: Editor

  beforeEach(() => {
    tokens = HEADING_TOKENS
    highlightsMap.clear()
    // @ts-expect-error happy-dom has no Highlight constructor
    globalThis.Highlight = MockHighlight
    setHighlightRegistry(mockRegistry)
    resetEditorInstanceCount()
    container = document.createElement('div')
    document.body.appendChild(container)
    editor = createVisibleEditor(container, { plugins: [highlighterPlugin()] })
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
    setHighlightRegistry(undefined)
    setEditorSyntaxSessionFactory(undefined)
  })

  it('paints the full display text when the token covers the buffer line', async () => {
    await openWithHeadingReplacement()

    const summary = paintedRanges().find((range) => range.text === 'Summary')
    expect(summary).toBeDefined()
    expect([summary!.start, summary!.end]).toEqual([0, 7])
  })

  it('mirrors replacement kinds onto the row element as classes', async () => {
    await openWithHeadingReplacement()

    const row = container.querySelector('.editor-inline-heading-marker-2')
    expect(row).not.toBeNull()
    expect(row!.textContent).toBe('Summary')
  })

  it('drops the kind classes when the replacements go away', async () => {
    await openWithHeadingReplacement()
    expect(container.querySelector('.editor-inline-heading-marker-2')).not.toBeNull()

    editor.setInlineReplacementProvider(null)
    await flush()

    expect(container.querySelector('.editor-inline-heading-marker-2')).toBeNull()
  })

  it('renders phantom text at a point the document never gained', async () => {
    editor.openDocument({ documentId: 'x.md', languageId: 'markdown', text: TEXT })
    await flush()
    editor.setInlineReplacementProvider(() => [
      { id: 'hint', startIndex: 3, endIndex: 3, text: 'name:', insertion: true },
    ])
    await flush()

    const rows = [...container.querySelectorAll('.editor-virtualized-row')]
    expect(rows.map((row) => row.textContent)).toContain('## name:Summary')
    expect(editor.materializeFullText()).toBe(TEXT)
  })

  it('boxes a run carrying a class so it can be styled apart from the text', async () => {
    await openWithPhantomHint({ className: 'editor-inlay-hint' })

    const boxed = container.querySelector('.editor-inlay-hint')
    expect(boxed?.textContent).toBe('name:')
    expect(boxed?.parentElement?.textContent).toBe('## name:Summary')
  })

  it('leaves a run unboxed when it asks for no class of its own', async () => {
    await openWithPhantomHint({})

    const row = container.querySelector('.editor-virtualized-row')
    expect(row?.textContent).toBe('## name:Summary')
    expect(row?.querySelector('[data-editor-inline-run]')).toBeNull()
  })

  it('keeps a token meeting a run at its point clear of the run', async () => {
    tokens = [
      { start: 0, end: 3, style: TOKEN_STYLE },
      { start: 3, end: 10, style: { color: '#00ff00' } },
    ]
    await openWithPhantomHint({})

    const painted = paintedRanges().map((range) => [range.start, range.end, range.text])
    expect(painted).toContainEqual([0, 3, '## name:Summary'])
    expect(painted).toContainEqual([8, 15, '## name:Summary'])
  })

  async function openWithPhantomHint(styling: { className?: string }): Promise<void> {
    editor.openDocument({ documentId: 'x.md', languageId: 'markdown', text: TEXT })
    await flush()
    editor.setInlineReplacementProvider(() => [
      { id: 'hint', startIndex: 3, endIndex: 3, text: 'name:', insertion: true, ...styling },
    ])
    await flush()
  }

  async function openWithHeadingReplacement(): Promise<void> {
    editor.openDocument({ documentId: 'x.md', languageId: 'markdown', text: TEXT })
    await flush()
    editor.setInlineReplacementProvider(() => [
      {
        id: 'h',
        startIndex: 0,
        endIndex: 3,
        text: '',
        kind: 'heading-marker-2',
        groupId: 'h',
      },
    ])
    await flush()
  }
})

function paintedRanges(): readonly { start: number; end: number; text: string | null }[] {
  const ranges = []
  for (const highlight of highlightsMap.values()) {
    for (const range of highlight) {
      ranges.push({
        start: range.startOffset,
        end: range.endOffset,
        text: range.startContainer.textContent,
      })
    }
  }
  return ranges
}

function highlighterPlugin(): EditorPlugin {
  return {
    name: 'test.highlighter',
    activate: (context) =>
      context.registerHighlighter({
        createSession: () => ({
          refresh: async () => ({ tokens: EditorTokenStore.fromTokens(tokens) }),
          applyChange: async () => ({ tokens: EditorTokenStore.fromTokens(tokens) }),
          dispose: () => undefined,
        }),
      }),
  }
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 180))
  await Promise.resolve()
  await Promise.resolve()
}
