import { type EditorSyntaxLanguageId } from '@singapore-editor/core/syntax'
import { createEditorLoggingPlugin, type EditorLogEvent } from '@singapore-editor/core/logging'
import { type EditorPlugin } from '@singapore-editor/core/extensions'
import {
  createBracketMatchPlugin,
  createDocumentLinkPlugin,
  createMergeConflictPlugin,
  createOccurrenceHighlightPlugin,
  type EditorScrollPosition,
} from '@singapore-editor/core/editor'
import { createEditorFindPlugin } from '@singapore-editor/find'
import { createFoldGutterPlugin } from '@singapore-editor/gutters/fold-gutter'
import { createLineGutterPlugin } from '@singapore-editor/gutters/line-gutter'
import { createMinimapPlugin } from '@singapore-editor/minimap'
import {
  createMarkdownAuthoringPlugin,
  createMarkdownPreviewPlugin,
} from '@singapore-editor/markdown'
import { createScopeLinesPlugin } from '@singapore-editor/scope-lines'
import { createHighlightingPlugin } from '@singapore-editor/highlighting'
import {
  EDITOR_PALETTE_SOURCE,
  EDITOR_THEME_SOURCE,
} from '@/features/editor/state/syntax-highlighting'
import { highlightingService } from '@/lib/highlighting/state/service'
import { log } from '@/lib/client-logging'
import { editorPerformanceFeatureDisabled } from '@/features/editor/state/performance-trace'
import { createDecodePlugin, createMorphPlugin, type DecodeMode } from '@singapore-editor/decode'
import { editorIndentationGuidesSupported } from '@/features/editor/utils/indentation-guides'
import { FOLD_CHEVRON_ICON } from '@/features/editor/utils/fold-icon'

const editorScrollPositionsByInstanceId = new Map<string, EditorScrollPosition>()
const PLATFORM_EDITOR_LOGGING_PLUGIN = createEditorLoggingPlugin(logEditorEvent, {
  name: 'platform.editor-logging',
})
const PLATFORM_SEARCH_RESULT_EDITOR_LOGGING_PLUGIN = createEditorLoggingPlugin(
  logSearchResultEditorEvent,
  {
    name: 'platform.search-result-editor-logging',
  },
)

export type CriticalEditorCorePluginOptions = {
  readonly analysisAllowed: boolean
  readonly syntaxHighlightingEnabled: boolean
  /** Backs the "Compare Changes" lens on a merge conflict; absent hides it. */
  readonly compareMergeConflict?: () => void
  /** Markdown renders in place (live preview); false shows its source. */
  readonly markdownPreview?: boolean
  readonly openMarkdownLink?: (href: string) => void
}

export function createCriticalEditorCorePlugins(
  languageId: EditorSyntaxLanguageId | null,
  indentationGuidesEnabled: boolean,
  minimapEnabled: boolean,
  options: CriticalEditorCorePluginOptions,
): readonly EditorPlugin[] {
  const includeGuides =
    options.analysisAllowed &&
    indentationGuidesEnabled &&
    editorIndentationGuidesSupported(languageId) &&
    !editorPerformanceFeatureDisabled('scope-lines')
  return (
    options.analysisAllowed && options.syntaxHighlightingEnabled
      ? createEditorSyntaxHighlightingPlugins(languageId)
      : []
  ).concat(
    options.analysisAllowed && languageId === 'markdown' ? [createMarkdownAuthoringPlugin()] : [],
    [createLineGutterPlugin()],
    options.analysisAllowed
      ? [
          createFoldGutterPlugin({
            width: 16,
            icon: FOLD_CHEVRON_ICON,
            iconClassName: 'size-3 [[data-editor-fold-state=collapsed]_&]:-rotate-90',
          }),
        ]
      : [],
    minimapEnabled && !editorPerformanceFeatureDisabled('minimap') ? [createMinimapPlugin()] : [],
    [createEditorFindPlugin()],
    options.analysisAllowed
      ? [
          createMergeConflictPlugin({ compare: options.compareMergeConflict }),
          createBracketMatchPlugin({
            style: { backgroundColor: 'var(--editor-bracket-match-background)' },
          }),
          createOccurrenceHighlightPlugin({
            style: {
              backgroundColor: 'var(--editor-occurrence-highlight-background)',
            },
          }),
          createDocumentLinkPlugin(),
        ]
      : [],
    includeGuides ? [createScopeLinesPlugin()] : [],
    // Critical rather than lazy: loading it after first paint would flash raw markdown first. It
    // derives its replacements from Markdown records, so a file renders as source
    // while syntax highlighting is off.
    options.analysisAllowed && languageId === 'markdown' && options.markdownPreview !== false
      ? [createMarkdownPreviewPlugin({ openLink: options.openMarkdownLink })]
      : [],
    [createPlatformEditorLoggingPlugin()],
  )
}

/** The motion plugins: the file-open reveal when `mode` is set, and the edit morph. */
export function createMotionPlugins(mode: DecodeMode | null, morph: boolean): EditorPlugin[] {
  const reveal: EditorPlugin[] = mode ? [createDecodePlugin({ mode })] : []
  return reveal.concat(morph ? [createMorphPlugin()] : [])
}

function createEditorSyntaxHighlightingPlugins(
  languageId: EditorSyntaxLanguageId | null,
): readonly EditorPlugin[] {
  if (editorPerformanceFeatureDisabled('syntax')) return []

  return [
    createHighlightingPlugin({
      name: 'platform.syntax',
      service: highlightingService(),
      theme:
        languageId === 'markdown' || languageId === 'mdx'
          ? EDITOR_PALETTE_SOURCE
          : EDITOR_THEME_SOURCE,
    }),
  ]
}

export function createPlatformEditorLoggingPlugin(): EditorPlugin {
  return PLATFORM_EDITOR_LOGGING_PLUGIN
}

export function createPlatformSearchResultEditorLoggingPlugin(): EditorPlugin {
  return PLATFORM_SEARCH_RESULT_EDITOR_LOGGING_PLUGIN
}

function logEditorEvent(event: EditorLogEvent): void {
  cacheEditorScrollPosition(event)
  if (event.action === 'editor.viewport.changed') return
  if (!shouldLogEditorEvent(event)) {
    forgetEditorScrollPosition(event)
    return
  }

  log[editorLogLevel(event)](() => ({
    ...editorEventScrollContext(event),
    ...event,
    area: 'editor',
    level: editorLogLevel(event),
  }))
  forgetEditorScrollPosition(event)
}

function shouldLogEditorEvent(event: EditorLogEvent): boolean {
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

  if (event.action === 'editor.lifecycle.summary') return 'info'
  return 'debug'
}

function logSearchResultEditorEvent(event: EditorLogEvent): void {
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
