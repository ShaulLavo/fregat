import { defaultEditorPacks } from '@singapore-editor/core/keymap'
import { createModalEditingPlugin, modalPack } from './modal/modalPlugin'
import { createMergeConflictPlugin, Editor, type EditorPlugin } from '@singapore-editor/core/editor'
import { createDiffPlugin } from '@singapore-editor/diff'
import '@singapore-editor/core/style.css'
import '@singapore-editor/diff/style.css'
import '@singapore-editor/find/style.css'
import '@singapore-editor/minimap/style.css'
import '@singapore-editor/scope-lines/style.css'
import { createEditorFindPlugin } from '@singapore-editor/find'
import { createFoldGutterPlugin, createLineGutterPlugin } from '@singapore-editor/gutters'
import { createMinimapPlugin } from '@singapore-editor/minimap'
import { createScopeLinesPlugin, createStickyScrollPlugin } from '@singapore-editor/scope-lines'
import { createSpellcheckPlugin, SpellcheckService } from '@singapore-editor/spellcheck'
import {
  css,
  html,
  javaScript,
  json,
  markdown,
  typeScript,
} from '@singapore-editor/tree-sitter-languages'
import {
  createTypeScriptLspPlugin,
  type TypeScriptLspDiagnosticSummary,
  type TypeScriptLspStatus,
} from '@singapore-editor/typescript-lsp'
import { createEditorPane } from './components/editorPane.ts'
import { createHistoryPanel, type HistoryPanel } from './components/historyPanel.ts'
import {
  createOutlinePanel,
  type OutlineClient,
  type OutlinePanel,
} from './components/outlinePanel.ts'
import { el } from './components/dom.ts'
import { createSidebar } from './components/sidebar.ts'
import { createStatusBar } from './components/statusBar.ts'
import { createTopBar } from './components/topBar.ts'
import { createFoldChevronIcon } from './foldGutterIcon.ts'
import { SourceController } from './sourceController.ts'

export function mountApp(): void {
  const app = document.getElementById('app')!
  const topBar = createTopBar()
  const sidebar = createSidebar()
  const editorPane = createEditorPane()
  const statusBar = createStatusBar()
  const main = el('div', { id: 'main' })
  main.append(sidebar.element, editorPane.element)

  app.append(topBar.element, main, statusBar.element)

  let controller: SourceController | null = null
  let historyPanel: HistoryPanel | null = null
  let outlinePanel: OutlinePanel | null = null
  let outlineClient: OutlineClient | null = null
  let typeScriptLspStatus: TypeScriptLspStatus = 'idle'
  let typeScriptDiagnostics: TypeScriptLspDiagnosticSummary | null = null
  const syncTypeScriptStatus = (): void => {
    statusBar.updateTypeScriptLsp(typeScriptLspStatus, typeScriptDiagnostics)
  }
  const typeScriptLsp = createTypeScriptLspPlugin({
    capabilities: { textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } } },
    // The connection starts while the editor mounts its plugins, before the outline exists.
    onConnectionCreated: (context) => {
      outlineClient = context.client
      outlinePanel?.setClient(outlineClient)
      return {
        dispose: () => {
          outlineClient = null
          outlinePanel?.setClient(null)
        },
      }
    },
    onApplyWorkspaceEdit: (request) =>
      controller?.applyWorkspaceEdit(request) ??
      Promise.resolve({ status: 'failed', code: 'NO_SOURCE', message: 'No source is loaded.' }),
    onStatusChange: (status) => {
      typeScriptLspStatus = status
      syncTypeScriptStatus()
    },
    onDiagnostics: (summary) => {
      typeScriptDiagnostics = summary
      syncTypeScriptStatus()
    },
    onOpenDefinition: (target) => controller?.openDefinition(target) ?? false,
    onError: (error) => {
      console.warn('[typescript-lsp]', error)
    },
  })
  const liveDiff = createDiffPlugin({ mode: 'overlay' })
  const languagePlugins: readonly EditorPlugin[] = [
    javaScript({ jsx: true }),
    typeScript(),
    typeScript({ tsx: true }),
    html(),
    css(),
    json(),
    markdown(),
  ]
  const lineGutter = createLineGutterPlugin()
  const foldGutter = createFoldGutterPlugin({
    width: 16,
    icon: createFoldChevronIcon,
    iconClassName: 'app-fold-gutter-icon',
  })
  const sharedPlugins: readonly EditorPlugin[] = [
    foldGutter,
    // Imported VS Code theme colours over the same structure: createHighlightingPlugin from
    // "@singapore-editor/highlighting", given a service that resolves the theme by id.
    createMergeConflictPlugin(),
    createEditorFindPlugin(),
    createScopeLinesPlugin(),
    createStickyScrollPlugin(),
    createMinimapPlugin(),
    // Prose in plain text and Markdown; comments and strings too, to show the code path.
    createSpellcheckPlugin({ service: new SpellcheckService(), scope: 'proseAndCode' }),
    typeScriptLsp,
  ]
  // `?modal` turns on the E028 modal editing proof.
  const modal = new URLSearchParams(location.search).has('modal')
    ? [createModalEditingPlugin()]
    : []
  const editPlugins: readonly EditorPlugin[] = languagePlugins.concat(
    lineGutter,
    liveDiff,
    sharedPlugins,
    modal,
  )
  const diffPlugins: readonly EditorPlugin[] = languagePlugins.concat(liveDiff, sharedPlugins)
  const editor = new Editor(editorPane.editorHost, {
    keymap: { packs: [...defaultEditorPacks, ...(modal.length ? [modalPack] : [])] },
    cursorLineHighlight: {
      gutterNumber: true,
      gutterBackground: ['fold-gutter'],
      rowBackground: true,
    },
    plugins: editPlugins,
    onChange: (state) => {
      controller?.updateStatus(state)
      historyPanel?.sync()
      outlinePanel?.refresh()
    },
  })
  historyPanel = createHistoryPanel(editor)
  outlinePanel = createOutlinePanel(editor)
  outlinePanel.setClient(outlineClient)
  main.append(outlinePanel.element, historyPanel.element)
  controller = new SourceController(topBar, sidebar, statusBar, editor, typeScriptLsp, liveDiff, {
    showEditor: () => {
      liveDiff.setEnabled(false)
      editor.setPlugins(editPlugins)
      editorPane.editorHost.hidden = false
    },
    showDiff: () => {
      editor.setPlugins(diffPlugins)
      editorPane.editorHost.hidden = false
    },
  })

  const inspect = el('button', { type: 'button' })
  inspect.textContent = 'Inspect piece tree'
  inspect.onclick = async () => {
    if (document.querySelector('dialog[aria-label="Piece tree inspector"]')) return
    const [{ openPieceTreeInspector }, { getPieceTreeSnapshot }] = await Promise.all([
      import('./components/pieceTreeInspector.ts'),
      import('@singapore-editor/core/debug'),
    ])
    if (document.querySelector('dialog[aria-label="Piece tree inspector"]')) return
    openPieceTreeInspector(() => getPieceTreeSnapshot(editor.getTextSnapshot()))
  }
  topBar.element.append(inspect)

  const history = el('button', { type: 'button', 'aria-pressed': 'false' })
  history.textContent = 'History'
  history.onclick = () => {
    const open = history.getAttribute('aria-pressed') !== 'true'
    history.setAttribute('aria-pressed', String(open))
    historyPanel?.setOpen(open)
  }
  topBar.element.append(history)

  const outline = el('button', { type: 'button', 'aria-pressed': 'false' })
  outline.textContent = 'Outline'
  outline.onclick = () => {
    const open = outline.getAttribute('aria-pressed') !== 'true'
    outline.setAttribute('aria-pressed', String(open))
    outlinePanel?.setOpen(open)
  }
  topBar.element.append(outline)

  syncTypeScriptStatus()
  controller.start()
}
