import { useMarkdownView } from '@/lib/markdown-mode/hooks/use-markdown-view'
import { useUnicodeHighlights } from '@/features/editor/hooks/use-unicode-highlights'
import { HOSTED_EDITOR_KEYMAP } from '@/keymap/editor-keymap'
import { useEditor } from '@singapore-editor/react'
import type { LanguageServerDefinitionTarget } from '@singapore-editor/lsp-plugin/websocket'
import type { LanguageServerReferencesResult } from '@singapore-editor/lsp-plugin'
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { Spinner } from '@workspace/ui/components/spinner'

import { EditorFrame } from '@/features/editor/components/frame'
import { DiagnosticPeek } from '@/features/editor/components/diagnostic-peek'
import {
  createCriticalEditorCorePlugins,
  createDecodePluginLoader,
} from '@/features/editor/utils/plugins'
import { selectionForDefinition } from '@/features/editor/utils/position'
import { languageIdForFilePath } from '@/lib/file-language'
import type { EditorStatusBarSource } from '@/features/editor/state/status-bar-source'
import type { EditorRenderDocument } from '@/features/editor/utils/render-document'
import { useCommitMessageEditorFocus } from '@/features/editor/hooks/use-commit-message-editor-focus'
import { useEditorColorTheme } from '@/lib/editor-theme/hooks/use-editor-color-theme'
import { useSettingValue } from '@/hooks/use-setting-value'
import { useScrollPersistencePlugin } from '@/features/editor/hooks/use-scroll-persistence-plugin'
import { useEditorTypography } from '@/features/editor/hooks/use-editor-typography'
import {
  capOverscrollTop,
  scrollPositionFromSnapshot,
} from '@/features/editor/utils/scroll-position'
import { useLanguageServerPlugin } from '@/features/editor/hooks/use-lsp-plugin'
import { useDiagnosticPeek } from '@/features/editor/hooks/use-diagnostic-peek'
import type { LanguageServerDocumentTarget } from '@/features/editor/utils/language-server-plugin'
import { editorPerformanceLayoutVariant } from '@/features/editor/state/performance-trace'
import { documentKey } from '@/lib/documents/utils/identity'
import { languageServerDocument } from '@/lib/language-server-document'
import { documentSourcePath, filesystemResource } from '@/lib/documents/utils/capabilities'
import type { DocumentKey, DocumentRef, FilesystemPath, TabId } from '@/lib/documents/utils/types'
import { useEditorFocusTarget } from '@/lib/focus/hooks/use-editor-target'
import type { DocumentSessionChange } from '@singapore-editor/core/document'
import type { EditorInitialPaintEvent, EditorPlugin } from '@singapore-editor/core/extensions'
import type { EditorScrollPosition } from '@singapore-editor/core/editor'
import { editorPreparedDocumentTags } from '@/features/editor/utils/prepared-document'
import { useMountedEditorRegistry } from '@/features/editor/hooks/use-mounted-editor-registry'
import { useRegisterEditorController } from '@/features/editor/hooks/use-register-editor-controller'
import type { SnapshotCaptureSource } from '@/lib/editor-visible-snapshot-cache'
import { effectiveDecodeMode } from '@/features/editor/utils/decode-mode'
import { useUnavailableEnvironment } from '@/lib/environments/hooks/use-unavailable-environment'

const NO_ADDITIONAL_PLUGINS: readonly EditorPlugin[] = []

type EditorProps = {
  active: boolean
  document: EditorRenderDocument | null
  /** Omitted means "no snapshot"; a null key would detach the document inside useEditor. */
  paintKey?: string
  target: DocumentRef
  snapshot?: string | null
  onCaptureSourceChange?: (source: SnapshotCaptureSource | null) => void

  languageServerTarget?: LanguageServerDocumentTarget
  additionalPlugins?: readonly EditorPlugin[]
  rootPath: FilesystemPath
  tabId: TabId
  definitionTarget?: LanguageServerDefinitionTarget | null
  onOpenDefinition?: (target: LanguageServerDefinitionTarget) => void | boolean
  onOpenReferences?: (result: LanguageServerReferencesResult) => void | boolean
  /** Opens the side-by-side view behind a merge conflict's "Compare Changes". */
  onCompareMergeConflict?: () => void
  onInitialPaint?: (event: EditorInitialPaintEvent) => void
  onScrollPositionChange?: (
    key: DocumentKey,
    scrollPosition: EditorScrollPosition,
    reopenScrollPosition?: EditorScrollPosition,
  ) => void
  onStatusSourceChange?: (source: EditorStatusBarSource) => void
  onTextChange?: (tabId: TabId, key: DocumentKey, change: DocumentSessionChange) => void
}

export function Editor({
  active,
  additionalPlugins = NO_ADDITIONAL_PLUGINS,
  definitionTarget,
  document: liveDocument,
  paintKey,
  target,
  snapshot,
  onCaptureSourceChange,

  languageServerTarget,
  rootPath,
  tabId,
  onOpenDefinition,
  onOpenReferences,
  onCompareMergeConflict,
  onInitialPaint,
  onScrollPositionChange,
  onStatusSourceChange,
  onTextChange,
}: EditorProps) {
  const [provisional, setProvisional] = useState(false)
  const unavailable = useUnavailableEnvironment()
  const currentTarget = liveDocument?.target ?? target
  const key = liveDocument?.key ?? documentKey(target)
  const resource = filesystemResource(currentTarget)
  const filePath = languageServerTarget?.matchPath ?? documentSourcePath(currentTarget) ?? ''
  const editability = unavailable || !liveDocument ? 'readonly' : liveDocument.editability
  const { appliedThemeContentHash, appliedThemeId, editorTheme, selectedThemeId } =
    useEditorColorTheme()
  const syntaxHighlightingEnabled = useSettingValue('editor.syntaxHighlighting.enabled')
  const indentationGuidesEnabled = useSettingValue('editor.guides.indentation')
  const minimapEnabled = useSettingValue('editor.minimap.enabled')
  const decodeSetting = useSettingValue('editor.decode.mode')
  const inputRoute = useSettingValue('editor.inputRoute')
  const decodeMode = effectiveDecodeMode(
    decodeSetting,
    typeof window === 'undefined' ? '' : location.search,
  )
  const mountedEditors = useMountedEditorRegistry()
  const diagnosticPeek = useDiagnosticPeek({ active, filePath })
  const { languageServer, languageServerStatusSource } = useLanguageServerPlugin({
    document: languageServerDocument(currentTarget),
    enabled:
      liveDocument !== null &&
      unavailable === null &&
      (resource !== null || languageServerTarget !== undefined),
    filePath,
    languageServerTarget,
    rootPath,
    onOpenDefinition,
    onOpenReferences,
    onDidNavigateDiagnostic: diagnosticPeek.onDidNavigateDiagnostic,
  })
  const scrollPersistencePlugin = useScrollPersistencePlugin({
    document: { key },
    onScrollPositionChange: liveDocument ? onScrollPositionChange : undefined,
  })
  const documentLanguageId =
    currentTarget.kind === 'settings-json' ? 'json' : languageIdForFilePath(filePath)
  // Stable tags keep an unrelated render from looking like a document reattachment.
  const preparedTags = useMemo(
    () =>
      editorPreparedDocumentTags(
        filePath,
        {
          appliedThemeContentHash,
          appliedThemeId,
          selectedThemeId,
          syntaxHighlightingEnabled,
        },
        documentLanguageId,
      ),
    [
      appliedThemeContentHash,
      appliedThemeId,
      documentLanguageId,
      filePath,
      selectedThemeId,
      syntaxHighlightingEnabled,
    ],
  )
  // Plugin identity controls native registration lifetime; the host keeps this callback stable
  // per conflict, so it rebuilds the plugins only when the conflict behind the tab changes.
  const markdownView = useMarkdownView(key)
  const markdownPreview = documentLanguageId === 'markdown' && markdownView === 'preview'
  const criticalEditorCorePlugins = useMemo(
    () =>
      createCriticalEditorCorePlugins(
        documentLanguageId,
        indentationGuidesEnabled,
        minimapEnabled,
        {
          compareMergeConflict: onCompareMergeConflict,
          markdownPreview,
        },
      ),
    [
      documentLanguageId,
      indentationGuidesEnabled,
      markdownPreview,
      minimapEnabled,
      onCompareMergeConflict,
    ],
  )
  const decodePlugin = useMemo(() => createDecodePluginLoader(decodeMode), [decodeMode])
  const unicodeHighlights = useUnicodeHighlights()
  const plugins = [
    ...criticalEditorCorePlugins,
    unicodeHighlights.plugin,
    diagnosticPeek.plugin,
    languageServer,
    decodePlugin,
    scrollPersistencePlugin,
    ...additionalPlugins,
  ]
  const document = liveDocument
    ? {
        documentId: liveDocument.key,
        buffer: liveDocument.buffer,
        ...preparedTags,
        languageId: documentLanguageId,
        preparedDocument: liveDocument.preparedDocument,
        text: '',
        view: liveDocument.view,
      }
    : null
  const typography = useEditorTypography()
  const rowPositioning = editorPerformanceLayoutVariant() === 'absolute-rows' ? 'top' : 'transform'
  const controller = useEditor({
    cursorLineHighlight: {
      gutterNumber: true,
      gutterBackground: ['fold-gutter'],
      rowBackground: true,
    },
    document,
    documentKey: paintKey,
    snapshot: decodeMode ? null : snapshot,
    editability,
    ...typography,
    inputRoute,
    keymap: HOSTED_EDITOR_KEYMAP,
    onChange: (_state, change) => {
      if (!liveDocument || !change || change.kind === 'selection' || change.kind === 'none') return

      onTextChange?.(tabId, key, change)
    },
    onInitialPaint,
    onPresentationChange: (state) => setProvisional(state === 'provisional'),
    plugins,
    rowPositioning,
    suspiciousCharacters: unicodeHighlights.options,
    theme: editorTheme,
  })
  useLayoutEffect(() => {
    // Decode changes visible text during its animation and has no replay contract.
    onCaptureSourceChange?.(
      decodeMode ? null : () => controller.getEditor()?.captureSnapshot() ?? null,
    )
    return () => onCaptureSourceChange?.(null)
  }, [controller, decodeMode, onCaptureSourceChange])
  const mountedPath = liveDocument ? resource?.path : undefined
  useRegisterEditorController(tabId, liveDocument ? controller : null)
  useLayoutEffect(
    () => (mountedPath ? mountedEditors.register(mountedPath) : undefined),
    [mountedPath, mountedEditors],
  )
  const settingsSurface = currentTarget.kind === 'settings-json'
  const focusTarget = useEditorFocusTarget({
    controller,
    writable: editability === 'editable',
    id: {
      key,
      kind: 'editor',
      surface: settingsSurface ? 'settings' : 'document',
      tabId,
    },
  })
  // Manual memo: `selection` is a useEffect dependency, and the compiler's cache is a
  // cache, not an identity guarantee — when it recomputes, the useEffect re-runs.
  const selection = useMemo(
    () =>
      definitionTarget && liveDocument
        ? selectionForDefinition(filePath, liveDocument.buffer.getTextSnapshot(), definitionTarget)
        : null,
    [definitionTarget, filePath, liveDocument],
  )

  useEffect(() => {
    if (!active || !liveDocument) return

    onStatusSourceChange?.({
      controller,
      filePath,
      languageServerStatusSource,
    })
  }, [active, controller, languageServerStatusSource, filePath, liveDocument, onStatusSourceChange])

  useLayoutEffect(() => {
    if (!liveDocument) return
    return () => {
      const snapshot = controller.getSnapshot()
      const scrollPosition =
        controller.getEditor()?.getScrollPosition() ?? scrollPositionFromSnapshot(snapshot)
      if (!scrollPosition) return

      onScrollPositionChange?.(key, scrollPosition, {
        left: scrollPosition.left,
        top:
          scrollPosition.top === undefined
            ? undefined
            : capOverscrollTop(scrollPosition.top, snapshot),
      })
    }
  }, [controller, key, liveDocument, onScrollPositionChange])

  useEffect(() => {
    if (!selection) return
    controller.commands.setSelection(selection.anchor, selection.head, {
      revealBlock: 'center',
      revealOffset: selection.anchor,
    })
  }, [controller, selection])

  useCommitMessageEditorFocus({
    controller,
    document: liveDocument,
  })

  return (
    <EditorFrame
      active={active && focusTarget.focused}
      controller={controller}
      onRequestCloseOverlay={diagnosticPeek.snapshot ? diagnosticPeek.close : undefined}
      targetRef={focusTarget.ref}
    >
      {provisional && liveDocument ? (
        <div className='bg-background text-muted-foreground absolute inset-x-0 bottom-0 flex items-center gap-2 px-3 py-2 text-xs'>
          <Spinner size='xs' label='Preparing editor' />
          Preparing editor…
        </div>
      ) : null}
      {diagnosticPeek.snapshot ? (
        <DiagnosticPeek
          model={diagnosticPeek.snapshot}
          onClose={diagnosticPeek.close}
          onOpenTarget={(target) => {
            onOpenDefinition?.(target)
          }}
          tabId={tabId}
        />
      ) : null}
    </EditorFrame>
  )
}
