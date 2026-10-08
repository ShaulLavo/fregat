import { Editor, type EditorPlugin } from '@singapore-editor/core/editor'
import { defaultEditorPacks } from '@singapore-editor/core/keymap'
import { createLineGutterPlugin, createFoldGutterPlugin } from '@singapore-editor/gutters'
import { createMinimapPlugin } from '@singapore-editor/minimap'
import '@singapore-editor/minimap/style.css'
import { createTypeScriptHighlighting } from './language'
import '@singapore-editor/core/style.css'
import '@singapore-editor/gutters/style.css'
import './style.css'

// Replaced by the build after Vite names the extracted stylesheet.
export const styles = ['__EMBED_CSS__']
type FirstFrame = {
  text: string
  anchor: number
  head: number
  focused: boolean
  scroll: { top: number; left: number }
}
type Options = { lineHeight?: number; label?: string; minimap?: boolean }
type Readout = {
  mode: string
  line: number
  col: number
  lines: number
  highlightApi: boolean
  ranges: number
  spans: number
  versionIndex: number
  versions: number
  branches: number
}

export function mountReal(host: HTMLElement, options: Options, frame: FirstFrame) {
  const css = getComputedStyle(host)
  const color = (name: string) => css.getPropertyValue(`--sg-${name}`).trim()
  const element = document.createElement('div')
  element.className = 'sg-real'
  const listeners = new Set<(state: Readout) => void>()
  const plugins: EditorPlugin[] = [
    createTypeScriptHighlighting(),
    createLineGutterPlugin(),
    createFoldGutterPlugin(),
  ]
  if (options.minimap) plugins.push(createMinimapPlugin())
  let mode = 'edit'
  let sample = frame.text
  let languageService: Promise<void> | null = null
  let editor: Editor | null = null
  const emit = () => {
    if (!editor) return
    const state = editor.getState()
    const graph = editor.getBufferSession()?.buffer.getHistoryGraph()
    const nodes = graph?.nodes ?? []
    let ranges = 0
    if ('highlights' in CSS) {
      for (const [name, highlight] of CSS.highlights) {
        if (name.startsWith('sg-')) continue
        for (const range of highlight) {
          if (host.contains(range.startContainer)) ranges++
        }
      }
    }
    const value: Readout = {
      mode,
      line: state.cursor.row + 1,
      col: state.cursor.column + 1,
      lines: editor.getTextSnapshot().lineCount,
      highlightApi: 'highlights' in CSS,
      ranges,
      spans: element.querySelectorAll('.token').length,
      versionIndex: Math.max(
        0,
        nodes.findIndex((node) => node.id === graph?.currentId),
      ),
      versions: Math.max(1, nodes.length),
      branches: nodes.filter((node) => node.childIds.length > 1).length,
    }
    listeners.forEach((fn) => fn(value))
    host.dataset.lines = String(value.lines)
    host.dataset.syntax = state.syntaxStatus
  }
  editor = new Editor(element, {
    plugins,
    keymap: { packs: defaultEditorPacks },
    fontFamily: color('font') || css.fontFamily,
    fontSize: parseFloat(color('size')) || 13.5,
    lineHeight: options.lineHeight ?? 20,
    tabSize: 2,
    theme: {
      type: color('bg').startsWith('#1') ? 'dark' : 'light',
      backgroundColor: color('bg'),
      foregroundColor: color('fg'),
      gutterBackgroundColor: color('bg'),
      gutterForegroundColor: color('gutter'),
      caretColor: color('caret') || color('fg'),
      selectionColor: color('selection'),
      popupBackgroundColor: color('bg'),
      syntax: {
        variable: color('fg'),
        variableBuiltin: color('fg'),
        constant: color('num'),
        namespace: color('type'),
        attribute: color('prop'),
        typeParameter: color('type'),
        keyword: color('kw'),
        keywordDeclaration: color('kw'),
        keywordImport: color('kw'),
        string: color('str'),
        comment: color('com'),
        number: color('num'),
        type: color('type'),
        typeDefinition: color('type'),
        function: color('fn'),
        property: color('prop'),
        bracket: color('punct'),
      },
    },
    onChange: emit,
  })
  host.replaceChildren(element)
  host.classList.add('is-real')
  element.setAttribute('aria-label', options.label ?? 'Singapore editor, TypeScript')
  editor.openDocument({ documentId: '/demo.ts', text: frame.text, languageId: 'typescript' })
  editor.setSelection(frame.anchor, frame.head)
  editor.setScrollPosition(frame.scroll)
  if (frame.focused) editor.focus()
  const startLanguageService = () => {
    if (mode === 'million' || languageService) return
    element.removeEventListener('pointermove', startLanguageService)
    host.dataset.typescript = 'loading'
    languageService = import('./typescript')
      .then(({ createLanguageService }) => {
        if (!editor) return
        plugins.push(
          createLanguageService((status) => {
            host.dataset.typescript = status
          }),
        )
        if (mode === 'edit') editor.setPlugins(plugins)
      })
      .catch((error) => {
        host.dataset.typescript = 'failed'
        console.error('TypeScript service failed', error)
      })
  }
  element.addEventListener(
    'keydown',
    (event) => {
      if (
        event.key.length === 1 ||
        event.key === 'Backspace' ||
        event.key === 'Delete' ||
        event.key === 'Enter'
      )
        startLanguageService()
    },
    { capture: true },
  )
  element.addEventListener('beforeinput', startLanguageService, { capture: true })
  element.addEventListener('pointermove', startLanguageService)
  // Highlight arrival is asynchronous and may leave the text unchanged.
  const highlights = new MutationObserver(emit)
  highlights.observe(element, { childList: true, subtree: true })
  window.addEventListener(
    'pagehide',
    () => {
      highlights.disconnect()
      editor?.dispose()
    },
    { once: true },
  )
  return {
    onChange(fn: (state: Readout) => void) {
      listeners.add(fn)
      emit()
    },
    openMillion() {
      if (!editor || mode === 'million') return
      sample = editor.materializeFullText()
      mode = 'million'
      host.dataset.typescript = 'suspended'
      editor.setPlugins([createLineGutterPlugin()])
      const lines = Array.from(
        { length: 1_000_000 },
        (_, index) => `export const line${index + 1} = ${index + 1};`,
      )
      editor.openDocument({
        documentId: '/million.ts',
        text: lines.join('\n'),
        languageId: 'plaintext',
      })
      editor.setSelection(0)
      emit()
    },
    closeMillion() {
      if (!editor) return
      mode = 'edit'
      editor.setPlugins(plugins)
      editor.openDocument({ documentId: '/demo.ts', text: sample, languageId: 'typescript' })
      emit()
    },
    load(text: string) {
      sample = text
      mode = 'edit'
      editor?.setPlugins(plugins)
      editor?.openDocument({ documentId: '/demo.ts', text, languageId: 'typescript' })
      editor?.setSelection(0)
      emit()
    },
    setVersion(index: number) {
      const buffer = editor?.getBufferSession()?.buffer
      const node = buffer?.getHistoryGraph().nodes[index]
      if (node) buffer?.checkoutHistoryState(node.id)
      emit()
    },
    focus() {
      editor?.focus()
    },
    get versions() {
      return editor?.getBufferSession()?.buffer.getHistoryGraph().retainedStates ?? 1
    },
  }
}
