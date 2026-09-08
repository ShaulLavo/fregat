import { HOSTED_EDITOR_KEYMAP } from '@/keymap/editor-keymap'
import { useEditor } from '@singapor/react'
import type {
  LanguageServerDefinitionTarget,
  LanguageServerReferencesResult,
} from '@singapor/lsp-plugin'
import { useEffect, useLayoutEffect, useMemo } from 'react'

import { EditorFrame } from '@/features/editor/components/frame'
import { DiagnosticPeek } from '@/features/editor/components/diagnostic-peek'
import {
  createCriticalEditorCorePlugins,
  createNonCriticalEditorPluginsLoaderPlugin,
} from '@/features/editor/utils/plugins'
import { selectionForDefinition } from '@/features/editor/utils/position'
import { languageIdForFilePath } from '@/features/editor/utils/file-path'
import type { EditorStatusBarSource } from '@/features/editor/state/status-bar-source'
import type { EditorRenderDocument } from '@/features/editor/utils/render-document'
import { useCommitMessageEditorFocus } from '@/features/editor/hooks/use-commit-message-editor-focus'
import { useEditorColorTheme } from '@/features/editor/hooks/use-editor-color-theme'
import { useSettingValue } from '@/features/settings/hooks/use-setting-value'
import { useScrollPersistencePlugin } from '@/features/editor/hooks/use-scroll-persistence-plugin'
import {
  capOverscrollTop,
  scrollPositionFromSnapshot,
} from '@/features/editor/utils/scroll-position'
import { useLanguageServerPlugin } from '@/features/editor/hooks/use-lsp-plugin'
import { useDiagnosticPeek } from '@/features/editor/hooks/use-diagnostic-peek'
import type { LanguageServerDocumentTarget } from '@/features/editor/utils/language-server-plugin'
import { editorPerformanceLayoutVariant } from '@/features/editor/state/performance-trace'
import {
  fileBackedDocumentPath,
  savableDocumentPath,
} from '@/features/editor/utils/file-backed-document'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'
import type {
  DocumentSessionChange,
  EditorInitialPaintEvent,
  EditorPlugin,
  EditorScrollPosition,
} from '@singapor/core'
import { editorPreparedDocumentTags } from '@/features/editor/utils/prepared-document'
import { useMountedEditorRegistry } from '@/features/editor/hooks/use-mounted-editor-registry'
import { useUnavailableEnvironment } from '@/lib/environments/hooks/use-unavailable-environment'

const NO_ADDITIONAL_PLUGINS: readonly EditorPlugin[] = []

type EditorProps = {
  active: boolean
  document: EditorRenderDocument

  languageServerTarget?: LanguageServerDocumentTarget
  additionalPlugins?: readonly EditorPlugin[]
  rootPath: string
  tabId: string
  definitionTarget?: LanguageServerDefinitionTarget | null
  onOpenDefinition?: (target: LanguageServerDefinitionTarget) => void | boolean
  onOpenReferences?: (result: LanguageServerReferencesResult) => void | boolean
  onInitialPaint?: (event: EditorInitialPaintEvent) => void
  onScrollPositionChange?: (path: string, scrollPosition: EditorScrollPosition) => void
  onStatusSourceChange?: (source: EditorStatusBarSource) => void
  onTextChange?: (tabId: string, path: string, change: DocumentSessionChange) => void
}

export function Editor({
  active,
  additionalPlugins = NO_ADDITIONAL_PLUGINS,
  definitionTarget,
  document: liveDocument,

  languageServerTarget,
  rootPath,
  tabId,
  onOpenDefinition,
  onOpenReferences,
  onInitialPaint,
  onScrollPositionChange,
  onStatusSourceChange,
  onTextChange,
}: EditorProps) {
  const unavailable = useUnavailableEnvironment()
  const editability = unavailable ? 'readonly' : liveDocument.editability
  const { appliedThemeContentHash, appliedThemeId, editorTheme, selectedThemeId } =
    useEditorColorTheme()
  const syntaxHighlightingEnabled = useSettingValue('editor.syntaxHighlighting.enabled')
  const indentationGuidesEnabled = useSettingValue('editor.guides.indentation')
  const mountedEditors = useMountedEditorRegistry()
  const diagnosticPeek = useDiagnosticPeek({ active, filePath: liveDocument.path })
  const { languageServer, languageServerStatusSource } = useLanguageServerPlugin({
    enabled: active && unavailable === null,
    filePath: liveDocument.path,
    languageServerTarget,
    rootPath,
    onOpenDefinition,
    onOpenReferences,
    onDidNavigateDiagnostic: diagnosticPeek.onDidNavigateDiagnostic,
  })
  const scrollPersistencePlugin = useScrollPersistencePlugin({
    document: liveDocument,
    onScrollPositionChange,
  })
  const documentLanguageId = languageIdForFilePath(liveDocument.path)
  // Stable tags keep an unrelated render from looking like a document reattachment.
  const preparedTags = useMemo(
    () =>
      editorPreparedDocumentTags(liveDocument.path, {
        appliedThemeContentHash,
        appliedThemeId,
        selectedThemeId,
        syntaxHighlightingEnabled,
      }),
    [
      appliedThemeContentHash,
      appliedThemeId,
      liveDocument.path,
      selectedThemeId,
      syntaxHighlightingEnabled,
    ],
  )
  const criticalEditorCorePlugins = useMemo(
    () => createCriticalEditorCorePlugins(documentLanguageId, indentationGuidesEnabled),
    [documentLanguageId, indentationGuidesEnabled],
  )
  const nonCriticalEditorPlugins = useMemo(() => createNonCriticalEditorPluginsLoaderPlugin(), [])
  const plugins = useMemo(
    () => [
      ...criticalEditorCorePlugins,
      diagnosticPeek.plugin,
      languageServer,
      nonCriticalEditorPlugins,
      scrollPersistencePlugin,
      ...additionalPlugins,
    ],
    [
      additionalPlugins,
      criticalEditorCorePlugins,
      diagnosticPeek.plugin,
      languageServer,
      nonCriticalEditorPlugins,
      scrollPersistencePlugin,
    ],
  )
  const document = useMemo(
    () => ({
      documentId: liveDocument.id,
      buffer: liveDocument.buffer,
      ...preparedTags,
      languageId: documentLanguageId,
      preparedDocument: liveDocument.preparedDocument,
      text: '',
      view: liveDocument.view,
    }),
    [
      documentLanguageId,
      liveDocument.buffer,
      liveDocument.id,
      liveDocument.preparedDocument,
      liveDocument.view,
      preparedTags,
    ],
  )
  const rowPositioning = editorPerformanceLayoutVariant() === 'absolute-rows' ? 'top' : 'transform'
  const controller = useEditor({
    cursorLineHighlight: {
      gutterNumber: true,
      gutterBackground: ['fold-gutter'],
      rowBackground: true,
    },
    document,
    editability,
    keymap: HOSTED_EDITOR_KEYMAP,
    onChange: (_state, change) => {
      if (!change || change.kind === 'selection' || change.kind === 'none') return

      onTextChange?.(tabId, liveDocument.path, change)
    },
    onInitialPaint,
    plugins,
    rowPositioning,
    theme: editorTheme,
  })
  useLayoutEffect(
    () => mountedEditors.register(liveDocument.path),
    [liveDocument.path, mountedEditors],
  )
  const settingsSurface =
    savableDocumentPath(liveDocument.path) !== null &&
    fileBackedDocumentPath(liveDocument.path) === null
  const focusTarget = useFocusTarget<HTMLDivElement>({
    area: 'editor',
    capabilities: {
      editor: {
        dispatch: controller.commands.dispatchCommand,
        getInputElement: () => controller.getEditor()?.getInputElement() ?? null,
        readKeymapContext: () => controller.getEditor()?.getKeymapContext() ?? null,
        writable: editability === 'editable',
      },
    },
    id: {
      key: liveDocument.id,
      kind: 'editor',
      surface: settingsSurface ? 'settings' : 'document',
      tabId,
    },
    onIntent: (intent) => {
      if (intent !== 'focus') return false

      controller.commands.focus()
      return true
    },
  })
  const selection = useMemo(
    () =>
      definitionTarget
        ? selectionForDefinition(
            liveDocument.path,
            liveDocument.buffer.getTextSnapshot(),
            definitionTarget,
          )
        : null,
    [definitionTarget, liveDocument.buffer, liveDocument.path],
  )

  useEffect(() => {
    if (!active) return

    onStatusSourceChange?.({
      controller,
      filePath: liveDocument.path,
      languageServerStatusSource,
    })
  }, [active, controller, languageServerStatusSource, liveDocument.path, onStatusSourceChange])

  useLayoutEffect(() => {
    return () => {
      const snapshot = controller.getSnapshot()
      const scrollPosition =
        controller.getEditor()?.getScrollPosition() ?? scrollPositionFromSnapshot(snapshot)
      if (!scrollPosition) return

      onScrollPositionChange?.(liveDocument.path, {
        left: scrollPosition.left,
        top:
          scrollPosition.top === undefined
            ? undefined
            : capOverscrollTop(scrollPosition.top, snapshot),
      })
    }
  }, [controller, liveDocument.path, onScrollPositionChange])

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
      targetRef={active ? focusTarget.ref : undefined}
    >
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
