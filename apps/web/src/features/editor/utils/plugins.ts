import {
  createBracketMatchPlugin,
  createDocumentLinkPlugin,
  createEditorLoggingPlugin,
  createMergeConflictPlugin,
  createOccurrenceHighlightPlugin,
  type EditorDisposable,
  type EditorLogEvent,
  type EditorPlugin,
  type EditorScrollPosition,
  type EditorSyntaxLanguageId,
} from '@singapor/core'
import { createEditorFindPlugin } from '@singapor/find'
import { createFoldGutterPlugin, createLineGutterPlugin } from '@singapor/gutters'
import type { FoldGutterIconContext } from '@singapor/gutters'
import { createMarkdownPreviewPlugin } from '@singapor/markdown'
import { createScopeLinesPlugin } from '@singapor/scope-lines'
import { createTreeSitterSyntaxPlugin } from '@singapor/tree-sitter'
import { subscribeActiveShikiTheme } from '@/features/editor/state/color-theme-store'
import { requestedDecodeMode } from '@/features/editor/utils/decode-mode'
import {
  editorShikiHighlighterProvider,
  editorSyntaxHighlightingSource,
  editorTreeSitterSyntaxProvider,
} from '@/features/editor/state/syntax-highlighting'
import { reportError, toClientError } from '@/lib/client-error-taxonomy'
import { log } from '@/lib/client-logging'
import { editorPerformanceFeatureDisabled } from '@/features/editor/state/performance-trace'
import { readSettingsMirror } from '@/features/settings/utils/boot-mirror'
import type { DecodeMode } from '@singapor/decode'
import { editorIndentationGuidesSupported } from '@/features/editor/utils/indentation-guides'

const editorScrollPositionsByInstanceId = new Map<string, EditorScrollPosition>()
const ignoredEditorInfoActions = new Set([
  'editor.plugins.gutters.changed',
  'editor.syntax.document_started',
])
const PLATFORM_EDITOR_CONSOLE_LOGGING_PLUGIN = createEditorLoggingPlugin(logEditorEventToConsole, {
  name: 'platform.editor-logging',
})
const PLATFORM_SEARCH_RESULT_EDITOR_LOGGING_PLUGIN = createEditorLoggingPlugin(
  logSearchResultEditorEventToConsole,
  {
    name: 'platform.search-result-editor-logging',
  },
)
let nonCriticalEditorPluginPromise: Promise<readonly EditorPlugin[]> | null = null

/**
 * `languageId` gates the language-specific plugins. Markdown preview is registered only for markdown
 * documents because registering it at all makes the editor ask tree-sitter for raw captures, and
 * that query is pure waste on a file shiki is already painting.
 */
export function createCriticalEditorCorePlugins(
  languageId: EditorSyntaxLanguageId | null,
  indentationGuidesEnabled: boolean,
): readonly EditorPlugin[] {
  const includeGuides =
    indentationGuidesEnabled &&
    editorIndentationGuidesSupported(languageId) &&
    !editorPerformanceFeatureDisabled('scope-lines')
  return [
    ...createEditorSyntaxHighlightingPlugins(),
    createLineGutterPlugin(),
    createFoldGutterPlugin({
      width: 16,
      icon: createFoldChevronIcon,
      iconClassName: 'app-fold-gutter-icon',
    }),
    createEditorFindPlugin(),
    createMergeConflictPlugin(),
    createBracketMatchPlugin({
      style: { backgroundColor: 'var(--editor-bracket-match-background)' },
    }),
    createOccurrenceHighlightPlugin({
      style: { backgroundColor: 'var(--editor-occurrence-highlight-background)' },
    }),
    createDocumentLinkPlugin(),
    ...(includeGuides ? [createScopeLinesPlugin()] : []),
    // Critical rather than lazy: loading it after first paint would flash raw markdown first. It
    // derives its replacements from tree-sitter's markdown captures, so a file renders as source
    // while syntax highlighting is off.
    ...(languageId === 'markdown' ? [createMarkdownPreviewPlugin()] : []),
    createPlatformEditorLoggingPlugin(),
  ]
}

export function createNonCriticalEditorPluginsLoaderPlugin(): EditorPlugin {
  return {
    name: 'platform.non-critical-editor-plugins',
    activate: (context) => {
      let disposed = false
      const disposables: EditorDisposable[] = []

      scheduleNonCriticalPluginLoad(async () => {
        const plugins = await loadNonCriticalEditorPlugins()
        if (disposed) return

        for (const plugin of plugins) {
          const disposable = activateLoadedEditorPlugin(plugin, context)
          if (disposable) disposables.push(disposable)
        }
      })

      return {
        dispose: () => {
          disposed = true
          disposeAll(disposables)
        },
      }
    },
  }
}

function loadNonCriticalEditorPlugins(): Promise<readonly EditorPlugin[]> {
  nonCriticalEditorPluginPromise ??= Promise.all(nonCriticalEditorPluginLoaders()).then((plugins) =>
    plugins.filter((plugin): plugin is EditorPlugin => plugin !== null),
  )
  return nonCriticalEditorPluginPromise
}

function nonCriticalEditorPluginLoaders(): readonly Promise<EditorPlugin | null>[] {
  const loaders: Promise<EditorPlugin | null>[] = []
  const settings = readSettingsMirror()
  if (settings['editor.minimap.enabled'] && !editorPerformanceFeatureDisabled('minimap')) {
    loaders.push(
      loadPlugin('@singapor/minimap', () =>
        import('@singapor/minimap').then((module) => module.createMinimapPlugin()),
      ),
    )
  }

  // File-open "writes itself" animation. The setting is the source of truth; the
  // `?decode=` query param survives as a debug override so a mode can be tried
  // without changing the user's document.
  const decodeMode =
    requestedDecodeMode(typeof window === 'undefined' ? '' : location.search) ??
    decodeModeFromSetting(settings['editor.decode.mode'])
  if (decodeMode) {
    loaders.push(
      loadPlugin('@singapor/decode', () =>
        import('@singapor/decode').then((module) =>
          module.createDecodePlugin({ mode: decodeMode }),
        ),
      ),
    )
  }

  return loaders
}

function scheduleNonCriticalPluginLoad(load: () => void) {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(load)
    return
  }

  queueMicrotask(load)
}

function activateLoadedEditorPlugin(
  plugin: EditorPlugin,
  context: Parameters<EditorPlugin['activate']>[0],
): EditorDisposable | null {
  try {
    return disposableFromActivationResult(plugin.activate(context))
  } catch (error) {
    reportError(
      toClientError({ code: 'OPERATION_FAILED', name: plugin.name ?? 'editor-plugin', error }),
    )
    return null
  }
}

function disposableFromActivationResult(
  result: ReturnType<EditorPlugin['activate']>,
): EditorDisposable | null {
  if (!result) return null
  if (!isEditorDisposableArray(result)) return result

  return {
    dispose: () => disposeAll(result),
  }
}

function isEditorDisposableArray(
  result: ReturnType<EditorPlugin['activate']>,
): result is readonly EditorDisposable[] {
  return Array.isArray(result)
}

function disposeAll(disposables: readonly EditorDisposable[]) {
  for (const disposable of disposables) disposable.dispose()
}

function createEditorSyntaxHighlightingPlugins(): readonly EditorPlugin[] {
  if (editorSyntaxHighlightingSource() === 'disabled') return []

  const treeSitter = editorTreeSitterSyntaxProvider()

  return [
    // Tree-sitter stays for structure (folds/brackets); its token output is
    // suppressed automatically once the shiki highlighter session exists.
    createTreeSitterSyntaxPlugin(treeSitter, { name: 'platform.tree-sitter-syntax' }),
    createEditorShikiHighlighterPlugin(),
  ]
}

/**
 * Registers the same Shiki provider instance that diff panes use. Re-registering on a theme change
 * reloads open editor sessions while the provider keeps its shared worker and language cache.
 */
function createEditorShikiHighlighterPlugin(): EditorPlugin {
  return {
    name: 'platform.shiki-highlighter',
    activate: (context) => {
      let registration: EditorDisposable | null = null

      const syncRegistration = () => {
        registration?.dispose()
        registration = null
        if (editorSyntaxHighlightingSource() !== 'shiki') return

        registration = context.registerHighlighter(editorShikiHighlighterProvider())
      }

      syncRegistration()
      const unsubscribe = subscribeActiveShikiTheme(syncRegistration)

      return {
        dispose: () => {
          unsubscribe()
          registration?.dispose()
          registration = null
        },
      }
    },
  }
}

async function loadPlugin(
  name: string,
  load: () => Promise<EditorPlugin>,
): Promise<EditorPlugin | null> {
  try {
    return await load()
  } catch (error) {
    reportError(toClientError({ code: 'OPERATION_FAILED', name, error }))
    return null
  }
}

/** Built once per document, not once per row: every fold icon is a clone of this prototype. */
const foldChevronPrototypes = new WeakMap<Document, SVGSVGElement>()

// CaretDown (bold, size 12) from @phosphor-icons/react 2.1.10, frozen as path
// data: rendering the React icon to markup put react-dom/server and the full
// icon barrel on the boot path for one constant glyph.
const FOLD_CHEVRON_PATH =
  'M216.49,104.49l-80,80a12,12,0,0,1-17,0l-80-80a12,12,0,0,1,17-17L128,159l71.51-71.52a12,12,0,0,1,17,17Z'

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

function foldChevronPrototype(document: Document): SVGSVGElement {
  const cached = foldChevronPrototypes.get(document)
  if (cached) return cached

  const prototype = document.createElementNS(SVG_NAMESPACE, 'svg')
  prototype.setAttribute('width', '12')
  prototype.setAttribute('height', '12')
  prototype.setAttribute('fill', 'currentColor')
  prototype.setAttribute('viewBox', '0 0 256 256')
  prototype.setAttribute('class', 'app-fold-chevron')
  const path = document.createElementNS(SVG_NAMESPACE, 'path')
  path.setAttribute('d', FOLD_CHEVRON_PATH)
  prototype.appendChild(path)
  foldChevronPrototypes.set(document, prototype)
  return prototype
}

function createFoldChevronIcon({ document }: FoldGutterIconContext): SVGSVGElement {
  return foldChevronPrototype(document).cloneNode(true) as SVGSVGElement
}

export function createPlatformEditorLoggingPlugin(): EditorPlugin {
  return PLATFORM_EDITOR_CONSOLE_LOGGING_PLUGIN
}

export function createPlatformSearchResultEditorLoggingPlugin(): EditorPlugin {
  return PLATFORM_SEARCH_RESULT_EDITOR_LOGGING_PLUGIN
}

function logEditorEventToConsole(event: EditorLogEvent): void {
  cacheEditorScrollPosition(event)
  if (event.action === 'editor.viewport.changed') return
  if (!shouldLogEditorEvent(event)) {
    forgetEditorScrollPosition(event)
    return
  }

  log[editorLogLevel(event)]({
    ...editorEventScrollContext(event),
    ...event,
    area: 'editor',
    level: editorLogPayloadLevel(event),
  })
  forgetEditorScrollPosition(event)
}

function shouldLogEditorEvent(event: EditorLogEvent): boolean {
  if (editorLogLevel(event) !== 'info') return true
  if (ignoredEditorInfoActions.has(event.action)) return false

  return !isShortEmptyEditorLifecycleSummary(event)
}

function isShortEmptyEditorLifecycleSummary(event: EditorLogEvent): boolean {
  if (event.action !== 'editor.lifecycle.summary') return false
  if (numberAtEventRecord(event, 'lifecycle', 'mountDurationMs') >= 100) return false
  if (numberAtEventRecord(event, 'document', 'openedCount') > 0) return false
  if (numberAtEventRecord(event, 'document', 'setTextCount') > 0) return false

  return numberAtEventRecord(event, 'document', 'syncedTextCount') === 0
}

function editorLogLevel(event: EditorLogEvent) {
  if (event.level === 'warn' || event.level === 'error') return event.level

  return 'info'
}

function editorLogPayloadLevel(event: EditorLogEvent) {
  if (event.action === 'editor.syntax.reloaded') return 'debug'
  return event.level
}

function logSearchResultEditorEventToConsole(event: EditorLogEvent): void {
  if (event.level !== 'warn' && event.level !== 'error') return

  log[event.level]({
    ...event,
    area: 'editor',
    surface: 'search-result',
  })
}

function cacheEditorScrollPosition(event: EditorLogEvent): void {
  const instanceId = editorLogInstanceId(event)
  const scrollPosition = editorLogScrollPosition(event)
  if (!instanceId || !scrollPosition) return

  editorScrollPositionsByInstanceId.set(instanceId, scrollPosition)
}

function editorEventScrollContext(event: EditorLogEvent): Record<string, unknown> {
  const instanceId = editorLogInstanceId(event)
  if (!instanceId) return {}

  const scrollPosition = editorScrollPositionsByInstanceId.get(instanceId)
  if (!scrollPosition) return {}

  return { scrollPosition }
}

function forgetEditorScrollPosition(event: EditorLogEvent): void {
  if (event.action !== 'editor.lifecycle.disposing') return

  const instanceId = editorLogInstanceId(event)
  if (!instanceId) return

  editorScrollPositionsByInstanceId.delete(instanceId)
}

function editorLogInstanceId(event: EditorLogEvent): string | null {
  const instanceId = event.editor?.instanceId
  return typeof instanceId === 'string' ? instanceId : null
}

function editorLogScrollPosition(event: EditorLogEvent): EditorScrollPosition | null {
  const viewport = event.viewport
  if (!editorLogViewportHasScrollPosition(viewport)) return null

  return {
    left: viewport.scrollLeft,
    top: viewport.scrollTop,
  }
}

function numberAtEventRecord(event: EditorLogEvent, parentKey: string, key: string) {
  const parent = (event as Record<string, unknown>)[parentKey]
  if (!parent || typeof parent !== 'object') return 0

  const value = (parent as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function editorLogViewportHasScrollPosition(
  viewport: unknown,
): viewport is { readonly scrollLeft: number; readonly scrollTop: number } {
  if (!viewport || typeof viewport !== 'object') return false

  return (
    typeof (viewport as Record<string, unknown>).scrollLeft === 'number' &&
    typeof (viewport as Record<string, unknown>).scrollTop === 'number'
  )
}

/** `off` is the registry's way of saying no plugin; the plugin has no such mode. */
function decodeModeFromSetting(mode: string): DecodeMode | null {
  return mode === 'off' ? null : (mode as DecodeMode)
}
