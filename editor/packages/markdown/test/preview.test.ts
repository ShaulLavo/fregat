import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor, createEditorStructuralOperation } from '@singapore-editor/core/editor'
import type { EditorPlugin } from '@singapore-editor/core/extensions'
import { markdownPack } from '@singapore-editor/core/keymap'
import { setHighlightRegistry, VirtualizedTextView } from '@singapore-editor/core/testing'
import {
  createEmptySyntaxResult,
  type EditorSyntaxResult,
  type EditorSyntaxRuntime,
} from '@singapore-editor/core/syntax'
import { init, MarkdownDocument } from 'tree-sitter-md'
import { createMarkdownAuthoringPlugin, createMarkdownPreviewPlugin } from '../src/index'

const DOCUMENT = '# Title\na **bold** b'

beforeAll(() => init())

const markdownSyntaxSession = (): EditorSyntaxRuntime => {
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
    analyze: async (read) => parse(read.text.readRange(0, read.text.length)),
    getResult: () => result,
    getTokens: () => [],
    getSnapshotVersion: () => 0,
    dispose: () => doc.dispose(),
  }
}

const markdownSyntaxPlugin: EditorPlugin = {
  activate: (context) =>
    context.registerSyntaxProvider({
      operation: createEditorStructuralOperation(() => markdownSyntaxSession()),
    }),
}

const highlights = new Map<string, Highlight>()
class MockHighlight extends Set<Range> {}

describe('markdown preview plugin', () => {
  let container: HTMLElement
  let editor: Editor

  const flush = async (): Promise<void> => {
    await vi.waitFor(() => expect(editor.getState().syntaxStatus).toBe('ready'))
  }

  // Read the mounted DOM rather than editor state: what the user actually sees is the assertion.
  const rowTexts = (): readonly string[] =>
    Array.from(
      container.querySelectorAll('[data-editor-virtual-row]'),
      (row) => row.textContent ?? '',
    )

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
    container = document.createElement('div')
    document.body.appendChild(container)
    editor = new Editor(container, {
      plugins: [
        markdownSyntaxPlugin,
        createMarkdownPreviewPlugin(),
        createMarkdownAuthoringPlugin(),
      ],
    })
    const view: unknown = Reflect.get(editor, 'view')
    // happy-dom has no layout, so deliver the first visible viewport measurement explicitly.
    if (view instanceof VirtualizedTextView) view.setScrollMetrics(0, 240, 640)
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
    highlights.clear()
    setHighlightRegistry(undefined)
    Reflect.deleteProperty(globalThis, 'Highlight')
  })

  it('renders markdown as formatted text', async () => {
    await openMarkdown()

    expect(rowTexts()).toEqual(['Title', 'a bold b'])
  })

  it('exposes parsed headings and links in live preview', async () => {
    editor.setText('# Title\n## Read [docs](https://example.com)\nSetext\n======\nplain', {
      languageId: 'markdown',
    })
    editor.setSelection(editor.materializeFullText().length)
    await flush()
    const headings = [...container.querySelectorAll('[role="heading"]')]
    expect(headings.map((row) => row.getAttribute('aria-level'))).toEqual(['1', '2', '1'])
    expect(headings.map((row) => row.textContent)).toEqual(['Title', 'Read docs', 'Setext'])
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
    editor.setText('plain\nsecond', { languageId: 'markdown' })
    await flush()
    expect(container.querySelector('[role="heading"]')).toBeNull()
  })

  it('names a multiline Setext heading with its full rendered title', async () => {
    editor.setText('First **line**\nsecond [line](https://example.com)\n===========\nplain', {
      languageId: 'markdown',
    })
    editor.setSelection(editor.materializeFullText().length)
    await flush()
    const headings = container.querySelectorAll('[role="heading"]')
    expect(headings).toHaveLength(1)
    expect(headings[0]?.getAttribute('aria-label')).toBe('First line second line')
  })

  it('names a wrapped ATX heading with its full rendered title', async () => {
    const title = 'Start ' + 'long title '.repeat(40) + 'END'
    editor.setText('# ' + title + '\nplain', { languageId: 'markdown' })
    editor.setSelection(editor.materializeFullText().length)
    editor.setWordWrap(true)
    await flush()
    editor.setScrollPosition({ top: 0 })
    const headings = container.querySelectorAll('[role="heading"]')
    expect(headings).toHaveLength(1)
    expect(headings[0]?.getAttribute('aria-label')).toBe(title)
  })

  it('clears heading semantics before recycling rows and when preview is removed', async () => {
    const source =
      '# Title\n' + Array.from({ length: 80 }, (_, index) => `plain ${index}`).join('\n')
    editor.setText(source, { languageId: 'markdown' })
    editor.setSelection(source.length)
    await flush()
    editor.setScrollPosition({ top: 0 })
    expect(container.querySelector('[role="heading"]')?.textContent).toBe('Title')
    editor.setScrollPosition({ top: 600 })
    expect(container.querySelector('[role="heading"]')).toBeNull()
    editor.setScrollPosition({ top: 0 })
    expect(container.querySelector('[role="heading"]')?.getAttribute('aria-level')).toBe('1')
    editor.setPlugins([markdownSyntaxPlugin])
    expect(container.querySelector('[role="heading"]')).toBeNull()
    expect(container.querySelector('[data-editor-virtual-row][aria-label]')).toBeNull()
  })

  it('keeps heading semantics when the caret reveals its source', async () => {
    await openMarkdown()
    editor.setSelection(3)
    await flush()
    expect(container.querySelector('[role="heading"]')?.getAttribute('aria-level')).toBe('1')
  })

  it('authors through a plain Editor with one undo entry and restores the selection', async () => {
    editor.setText('hello', { languageId: 'markdown' })
    editor.setSelection(0, 5)
    await flush()
    expect(editor.dispatchCommand('markdown.bold')).toBe(true)
    expect(editor.materializeFullText()).toBe('**hello**')
    expect(editor.getSelections()[0]).toMatchObject({ anchorOffset: 2, headOffset: 7 })
    editor.dispatchCommand('undo')
    expect(editor.materializeFullText()).toBe('hello')
    expect(editor.getSelections()[0]).toMatchObject({ anchorOffset: 0, headOffset: 5 })
    editor.dispatchCommand('redo')
    expect(editor.materializeFullText()).toBe('**hello**')
  })

  it('defers link editing until current records arrive', async () => {
    editor.setText('[docs](https://example.com)', { languageId: 'markdown' })
    editor.setSelection(3)
    expect(editor.getSyntaxRecords()).toBeNull()
    expect(editor.dispatchCommand('markdown.link')).toBe(true)
    expect(editor.materializeFullText()).toBe('[docs](https://example.com)')
    await flush()
    expect(editor.getSelections()[0]).toMatchObject({ anchorOffset: 7, headOffset: 26 })
    expect(editor.materializeFullText()).toBe('[docs](https://example.com)')
  })

  it('cancels deferred formatting when the selection or document changes', async () => {
    editor.setText('**hello**', { languageId: 'markdown' })
    editor.setSelection(4)
    editor.dispatchCommand('markdown.bold')
    editor.setSelection(0)
    editor.setSelection(4)
    await flush()
    expect(editor.materializeFullText()).toBe('**hello**')
    editor.setText('**other**', { languageId: 'markdown' })
    editor.setSelection(4)
    editor.dispatchCommand('markdown.bold')
    editor.setText('next', { languageId: 'markdown' })
    await flush()
    expect(editor.materializeFullText()).toBe('next')
  })

  it('declines Markdown commands in a different language', () => {
    editor.setText('hello', { languageId: 'typescript' })
    editor.setSelection(0, 5)
    expect(editor.dispatchCommand('markdown.bold')).toBe(false)
    expect(editor.materializeFullText()).toBe('hello')
  })

  it('refuses authoring in a read-only editor even through direct command dispatch', () => {
    editor.setText('hello', { languageId: 'markdown' })
    editor.setSelection(0, 5)
    editor.setEditability('readonly')
    expect(editor.dispatchCommand('markdown.bold')).toBe(false)
    expect(editor.materializeFullText()).toBe('hello')
  })

  it('indents a list item from its text and outdents it with Shift+Tab', () => {
    editor.setKeymap({ packs: [markdownPack] })
    editor.setText('- first\n- second', { languageId: 'markdown' })
    editor.setSelection(16)
    editor
      .getInputElement()
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(editor.materializeFullText()).toMatch(/^- first\n\s+- second$/)
    editor.getInputElement().dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(editor.materializeFullText()).toBe('- first\n- second')
  })

  it('leaves modified Tab shortcuts available to the host', () => {
    editor.setKeymap({ packs: [markdownPack] })
    editor.setText('- item', { languageId: 'markdown' })
    editor.setSelection(6)
    editor.getInputElement().dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(editor.materializeFullText()).toBe('- item')
  })

  it('uses current parser records to remove a mark around the caret', async () => {
    await openMarkdown()
    editor.setSelection(13)
    expect(editor.dispatchCommand('markdown.bold')).toBe(true)
    expect(editor.materializeFullText()).toBe('# Title\na bold b')
    expect(editor.getSelections()[0]).toMatchObject({ anchorOffset: 11, headOffset: 11 })
  })

  it('selects an existing link destination without changing the document or adding undo', async () => {
    editor.setText('[docs](https://example.com/a(b) "Title")', { languageId: 'markdown' })
    await flush()
    editor.setSelection(3)
    expect(editor.dispatchCommand('markdown.link')).toBe(true)
    expect(editor.getSelections()[0]).toMatchObject({ anchorOffset: 7, headOffset: 31 })
    expect(editor.materializeFullText()).toBe('[docs](https://example.com/a(b) "Title")')
  })

  it('removes code delimiters and their semantic padding at the caret', async () => {
    editor.setText('`` `literal` ``', { languageId: 'markdown' })
    await flush()
    editor.setSelection(6)
    expect(editor.dispatchCommand('markdown.code')).toBe(true)
    expect(editor.materializeFullText()).toBe('`literal`')
    expect(editor.getSelections()[0]).toMatchObject({ anchorOffset: 3, headOffset: 3 })
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

  it('opens link labels by click or Enter with their resolved destination and unchanged source', async () => {
    const opened: string[] = []
    editor.setPlugins([
      markdownSyntaxPlugin,
      createMarkdownPreviewPlugin({ openLink: (href) => opened.push(href) }),
    ])
    const source =
      'start\n\n[**docs**](https://example.com/a(b)?x=1&amp;y=2 "Docs")\n\n[reference][ref]\n\n[ref]: /guide.md\n'
    editor.setText(source, { languageId: 'markdown' })
    await flush()
    const links = [...container.querySelectorAll('a')]
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['docs', 'https://example.com/a(b)?x=1&y=2'],
      ['reference', '/guide.md'],
    ])
    links[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    links[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    links[0]!.dispatchEvent(enter)
    expect(enter.defaultPrevented).toBe(true)
    expect(opened).toEqual([
      'https://example.com/a(b)?x=1&y=2',
      '/guide.md',
      'https://example.com/a(b)?x=1&y=2',
    ])
    expect(editor.materializeFullText()).toBe(source)
    editor.setSelection(source.indexOf('docs'), source.indexOf('docs'))
    expect(rowTexts()).toContain('[**docs**](https://example.com/a(b)?x=1&amp;y=2 "Docs")')
    editor.setSelection(0, 0)
    expect(container.querySelector('a')?.textContent).toBe('docs')
  })

  it('leaves unsafe destinations as source without an active anchor', async () => {
    editor.setText('start\n\n[label](javascript:alert%281%29)', { languageId: 'markdown' })
    await flush()
    editor.setSelection(0, 0)
    expect(container.querySelector('a')).toBeNull()
    expect(rowTexts()).toContain('[label](javascript:alert%281%29)')
  })

  for (const [source, label, href] of [
    ['[angle](<https://example.com/a b>)', 'angle', 'https://example.com/a b'],
    ['[escaped](docs/a\\(b\\).md)', 'escaped', 'docs/a(b).md'],
    ['[Mixed Case][]\n\n[mixed case]: /first\n[mixed case]: /second', 'Mixed Case', '/first'],
    ['[label](< javascript:alert(1)>)', null, null],
  ] as const) {
    it(`resolves the parsed destination for ${source}`, async () => {
      editor.setText(`start\n\n${source}`, { languageId: 'markdown' })
      await flush()
      editor.setSelection(0, 0)
      const anchor = container.querySelector('a')
      expect(anchor?.textContent ?? null).toBe(label)
      expect(anchor?.getAttribute('href') ?? null).toBe(href)
    })
  }

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
