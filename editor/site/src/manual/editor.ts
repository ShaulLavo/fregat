import { Editor, type EditorPlugin } from '@singapore-editor/core/editor'
import type { EditorTheme } from '@singapore-editor/core/rendering'
import { defaultEditorPacks, markdownPack } from '@singapore-editor/core/keymap'
import { createEditorFindPlugin } from '@singapore-editor/find'
import { createLineGutterPlugin } from '@singapore-editor/gutters'
import {
  createMarkdownAuthoringPlugin,
  createMarkdownPreviewPlugin,
} from '@singapore-editor/markdown'
import { createTreeSitterLanguagePlugin } from '@singapore-editor/tree-sitter'
import { Kind } from 'tree-sitter-md'
import { FENCE_LANGUAGE_IDS, languageContribution } from './languages'
import { SYNTAX_COLORS, type SyntaxColorId } from './theme'
import '@singapore-editor/core/style.css'
import '@singapore-editor/gutters/style.css'
import '@singapore-editor/find/style.css'
import '@singapore-editor/markdown/style.css'
import './editor.css'

type DocsEditorOptions = {
  readonly documentId: string
  readonly languageId: string
  readonly text: string
  readonly lineHeight: number
  readonly fontSize: number
  readonly fontFamily: string
  readonly gutterWidth: number
  readonly label: string
  readonly openLink: (href: string) => void
  /** The palette role the text area paints with; code samples sit on `code-bg`. */
  readonly background?: 'bg' | 'code-bg'
}

export type DocsEditor = ReturnType<typeof mountDocsEditor>

/** Reads the page palette as resolved colours; `light-dark()` values resolve against the page. */
function paletteTheme(host: HTMLElement, surface: 'bg' | 'code-bg'): EditorTheme {
  const probe = document.createElement('span')
  probe.hidden = true
  host.append(probe)
  const color = (role: string) => {
    probe.style.color = `var(--sg-${role})`
    return getComputedStyle(probe).color
  }
  const syntax = Object.fromEntries(
    (Object.entries(SYNTAX_COLORS) as [SyntaxColorId, string][]).map(([id, role]) => [
      id,
      color(role),
    ]),
  )
  const background = color('bg')
  const [red = 0, green = 0, blue = 0] = background.match(/[\d.]+/g)?.map(Number) ?? []
  const theme: EditorTheme = {
    type: 0.2126 * red + 0.7152 * green + 0.0722 * blue < 128 ? 'dark' : 'light',
    backgroundColor: color(surface),
    foregroundColor: color('fg'),
    gutterBackgroundColor: color('bg'),
    gutterForegroundColor: color('gutter'),
    caretColor: color('caret'),
    selectionColor: color('selection'),
    popupBackgroundColor: color('bg'),
    syntax,
  }
  probe.remove()
  return theme
}

export function mountDocsEditor(host: HTMLElement, options: DocsEditorOptions) {
  const element = document.createElement('div')
  element.className = 'sg-docs-editor'
  host.append(element)
  const plugins: EditorPlugin[] = [
    createTreeSitterLanguagePlugin(
      ['markdown', ...FENCE_LANGUAGE_IDS].map((id) => languageContribution(id)),
      { name: 'tree-sitter-docs' },
    ),
    createMarkdownPreviewPlugin({ openLink: options.openLink }),
    createMarkdownAuthoringPlugin(),
    createLineGutterPlugin({ minWidth: options.gutterWidth }),
    createEditorFindPlugin(),
  ]
  const listeners = new Set<() => void>()
  let decoratedRecords: Uint32Array | null = null
  const decorate = () => {
    const records = editor.getSyntaxRecords()
    if (!records || records.data === decoratedRecords) return
    decoratedRecords = records.data
    editor.setRowDecorations(codeRows(records.data, editor))
    for (const listener of listeners) listener()
  }
  const editor: Editor = new Editor(element, {
    presentationReady: false,
    plugins,
    keymap: { packs: [...defaultEditorPacks, markdownPack] },
    fontFamily: options.fontFamily,
    fontSize: options.fontSize,
    lineHeight: options.lineHeight,
    tabSize: 2,
    wordWrap: true,
    wordWrapBreak: 'word',
    // The gutter belongs to the page: it scrolls with the text, as the static rows do.
    gutterScroll: 'content',
    theme: paletteTheme(host, options.background ?? 'bg'),
    onChange: () => {
      decorate()
      for (const listener of listeners) listener()
    },
  })
  // Tab moves focus on and off the page; the editor is a reader first.
  editor.setTabMovesFocus(true)
  element.setAttribute('aria-label', options.label)
  editor.openDocument({
    documentId: options.documentId,
    text: options.text,
    languageId: options.languageId,
  })
  // Syntax may arrive without a text change.
  const rows = new MutationObserver(decorate)
  rows.observe(element, { childList: true, subtree: true })
  return {
    editor,
    element,
    onChange(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    /**
     * Resolves once the preview for the current text has painted; Markdown only. Rejects when
     * syntax or the preview does not arrive in time, so callers keep the static page.
     */
    async ready(timeoutMs = 8000) {
      const started = performance.now()
      while (!(editor.getSyntaxRecords() && element.querySelector('[class*="editor-inline-"]'))) {
        const waited = performance.now() - started
        if (waited >= timeoutMs)
          throw new TypeError(`The Markdown preview did not paint within ${Math.round(waited)} ms`)
        await nextFrame()
      }
      decorate()
      await nextFrame()
      await nextFrame()
      return performance.now() - started
    },
    /** Resolves once code highlighting has painted; rejects when it does not arrive in time. */
    async highlighted(timeoutMs = 8000) {
      const started = performance.now()
      while (CSS.highlights.size === 0) {
        const waited = performance.now() - started
        if (waited >= timeoutMs)
          throw new TypeError(`Code highlighting did not paint within ${Math.round(waited)} ms`)
        await nextFrame()
      }
      await nextFrame()
      return performance.now() - started
    },
    open(documentId: string, text: string, languageId = 'markdown') {
      decoratedRecords = null
      editor.openDocument({ documentId, text, languageId })
    },
    refreshTheme() {
      editor.setTheme(paletteTheme(host, options.background ?? 'bg'))
    },
    text() {
      return editor.materializeFullText()
    },
    dispose() {
      rows.disconnect()
      editor.dispose()
      element.remove()
    },
  }
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

function codeRows(records: Uint32Array, editor: Editor) {
  const source = editor.getTextSnapshot()
  const rows = new Map<number, { className: string; snapshotStyle: 'colors' }>()
  for (let index = 0; index < records.length; index += 4) {
    const start = records[index]!
    const end = records[index + 1]!
    if (records[index + 2] !== Kind.CodeBlock || end <= start) continue
    const first = source.lineAt(start)
    const last = source.lineAt(Math.max(start, end - 1))
    for (let row = first; row <= last; row++)
      rows.set(row, { className: 'sg-code-row', snapshotStyle: 'colors' })
  }
  return rows
}
