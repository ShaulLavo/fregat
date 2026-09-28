import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Editor } from '@singapore-editor/core/editor'
import {
  setEditorSyntaxSessionFactory,
  setHighlightRegistry,
  VirtualizedTextView,
} from '@singapore-editor/core/testing'
import {
  createEmptySyntaxResult,
  type EditorSyntaxResult,
  type EditorSyntaxSession,
} from '@singapore-editor/core/syntax'
import { init, MarkdownDocument } from 'tree-sitter-md'
import { createMarkdownPreviewPlugin } from '../src/index'

const DOCUMENT = '# Title\na **bold** b'

beforeAll(() => init())

const markdownSyntaxSession = (): EditorSyntaxSession => {
  const doc = new MarkdownDocument({ frontmatter: true })
  let result = createEmptySyntaxResult()
  const parse = (text: string): EditorSyntaxResult => {
    doc.setText(text)
    result = {
      ...createEmptySyntaxResult(),
      records: { languageId: 'markdown', data: doc.decorations(0, text.length) },
    }
    return result
  }
  return {
    foldingSupport: 'supported',
    refresh: async (snapshot) => parse(snapshot.readRange(0, snapshot.length)),
    applyChange: async (change) =>
      parse(change.textSnapshot.readRange(0, change.textSnapshot.length)),
    getResult: () => result,
    getTokens: () => [],
    getSnapshotVersion: () => 0,
    dispose: () => doc.dispose(),
  }
}

const highlights = new Map<string, Highlight>()
class MockHighlight extends Set<Range> {}

const flush = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

describe('markdown preview plugin', () => {
  let container: HTMLElement
  let editor: Editor

  // Read the mounted DOM rather than editor state: what the user actually sees is the assertion.
  const rowTexts = (): readonly string[] =>
    [...container.querySelectorAll('[data-editor-virtual-row]')].map((row) => row.textContent ?? '')

  const openMarkdown = async (languageId = 'markdown'): Promise<void> => {
    editor.openDocument({ documentId: 'notes.md', text: DOCUMENT, languageId })
    await flush()
  }

  beforeEach(() => {
    // @ts-expect-error happy-dom does not provide Highlight.
    globalThis.Highlight = MockHighlight
    setHighlightRegistry({
      set: (name: string, highlight: Highlight) => highlights.set(name, highlight),
      delete: (name: string) => highlights.delete(name),
    })
    setEditorSyntaxSessionFactory(() => markdownSyntaxSession())
    container = document.createElement('div')
    document.body.appendChild(container)
    editor = new Editor(container, { plugins: [createMarkdownPreviewPlugin()] })
    const view: unknown = Reflect.get(editor, 'view')
    // happy-dom has no layout, so deliver the first visible viewport measurement explicitly.
    if (view instanceof VirtualizedTextView) view.setScrollMetrics(0, 240, 640)
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
    highlights.clear()
    setEditorSyntaxSessionFactory(undefined)
    setHighlightRegistry(undefined)
    Reflect.deleteProperty(globalThis, 'Highlight')
  })

  it('renders markdown as formatted text', async () => {
    await openMarkdown()

    expect(rowTexts()).toEqual(['Title', 'a bold b'])
  })

  it('brings the source back under the caret', async () => {
    await openMarkdown()
    editor.setSelection(14, 14)

    expect(rowTexts()).toEqual(['Title', 'a **bold** b'])
  })

  it('re-hides the source once the caret leaves', async () => {
    await openMarkdown()
    editor.setSelection(14, 14)
    editor.setSelection(0, 0)

    expect(rowTexts()[1]).toBe('a bold b')
  })

  it('leaves the buffer holding markdown source', async () => {
    await openMarkdown()

    expect(editor.materializeFullText()).toBe(DOCUMENT)
  })

  it('leaves non-markdown documents as source', async () => {
    await openMarkdown('typescript')

    expect(rowTexts()).toEqual(['# Title', 'a **bold** b'])
  })
  for (const source of [
    '**bold** and _italic_',
    '[label](/destination)',
    '![alt](/image)',
    '> **one\n> two**',
    '- [x] task',
    '| a | b |\n| - | - |\n| **cell** | value |',
    '```js\nconst value = 1\n```',
    '**שלום 🪐**',
    '[label][ref]\n\n[ref]: /eof',
  ]) {
    it(`keeps editing and composition source-equivalent: ${JSON.stringify(source)}`, async () => {
      const plainContainer = document.createElement('div')
      document.body.appendChild(plainContainer)
      const plain = new Editor(plainContainer)
      try {
        editor.openDocument({ documentId: 'preview.md', text: source, languageId: 'markdown' })
        plain.openDocument({ documentId: 'source.md', text: source, languageId: 'markdown' })
        await flush()
        editor.setSelection(0, source.length)
        const copied = new Map<string, string>()
        const copy = new Event('copy', { bubbles: true, cancelable: true })
        Object.defineProperty(copy, 'clipboardData', {
          value: { setData: (type: string, value: string) => copied.set(type, value) },
        })
        container.querySelector('textarea')!.dispatchEvent(copy)
        expect(copied.get('text/plain')).toBe(source)
        for (const [type, data] of [
          ['insertText', 'x'],
          ['deleteContentBackward', null],
          ['historyUndo', null],
          ['historyRedo', null],
        ] as const) {
          for (const [subject, host] of [
            [editor, container],
            [plain, plainContainer],
          ] as const) {
            subject.setSelection(2, 2)
            host.querySelector('textarea')!.dispatchEvent(
              new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: type,
                data,
              }),
            )
          }
          await flush()
          expect(editor.materializeFullText()).toBe(plain.materializeFullText())
        }
        for (const [subject, host] of [
          [editor, container],
          [plain, plainContainer],
        ] as const) {
          subject.setSelection(2, 2)
          for (const type of ['compositionstart', 'compositionupdate', 'compositionend']) {
            const event = new Event(type, { bubbles: true })
            Object.defineProperty(event, 'data', {
              value: type === 'compositionstart' ? '' : '日本',
            })
            host.querySelector('textarea')!.dispatchEvent(event)
          }
        }
        await flush()
        expect(editor.materializeFullText()).toBe(plain.materializeFullText())
        expect(editor.materializeFullText()).toContain('日本')
      } finally {
        plain.dispose()
        plainContainer.remove()
      }
    })
  }
})
