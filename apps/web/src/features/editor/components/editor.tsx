import {
  useEditorConflictState,
  type FilesystemConflict,
  type RetainedFilesystemComparison,
} from '@/features/editor/state/conflict-state'
import { useEditorDocumentState } from '@/features/editor/state/document-state'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import type { SettingsComparisonPresentation } from '@/lib/diff-attachment'
import { filesystemDiffAttachment } from '@/features/editor/utils/attachment-presentation'
import { DiffEditor } from '@/features/editor/components/diff-editor'
import { Button } from '@workspace/ui/components/button'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { useDocumentFeatureTier } from '@/features/editor/hooks/use-document-feature-tier'
import { useUndoBarrierPlugin } from '@/features/editor/hooks/use-undo-barrier-plugin'
import { fileExtension } from '@/lib/path-formatters'
import { LargeFileNotice } from '@/features/editor/components/large-file-notice'
import { useMarkdownView } from '@/lib/markdown-mode/hooks/use-markdown-view'
import { useMarkdownLinkOpener } from '@/features/editor/hooks/use-markdown-link-opener'
import { useUnicodeHighlights } from '@/features/editor/hooks/use-unicode-highlights'
import { useCommand } from '@/keymap/hooks/use-command'
import { useEditor } from '@singapore-editor/react'
import type { LanguageServerDefinitionTarget } from '@singapore-editor/lsp-plugin/websocket'
import type { LanguageServerReferencesResult } from '@singapore-editor/lsp-plugin'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Spinner } from '@workspace/ui/components/spinner'

import { EditorFrame } from '@/features/editor/components/frame'
import { DiagnosticPeek } from '@/features/editor/components/diagnostic-peek'
import {
  createCriticalEditorCorePlugins,
  createMotionPlugins,
} from '@/features/editor/utils/plugins'
import { selectionForDefinition } from '@/features/editor/utils/position'
import { languageIdForFilePath } from '@/lib/file-language'
import type { EditorStatusBarSource } from '@/features/editor/state/status-bar-source'
import type { EditorRenderDocument } from '@/features/editor/utils/render-document'
import { useCommitMessageEditorFocus } from '@/features/editor/hooks/use-commit-message-editor-focus'
import { useEditorColorTheme } from '@/lib/editor-theme/hooks/use-editor-color-theme'
import { useSettingValue } from '@/hooks/use-setting-value'
import { useScrollPersistencePlugin } from '@/features/editor/hooks/use-scroll-persistence-plugin'
import { useEditorGutterInset } from '@/hooks/use-editor-gutter-inset'
import { useEditorTypography } from '@/features/editor/hooks/use-editor-typography'
import {
  capOverscrollTop,
  scrollPositionFromSnapshot,
} from '@/features/editor/utils/scroll-position'
import { useLanguageServerPlugin } from '@/features/editor/hooks/use-lsp-plugin'
import { useDiagnosticPeek } from '@/features/editor/hooks/use-diagnostic-peek'
import { useSpellcheckPlugin } from '@/features/editor/hooks/use-spellcheck-plugin'
import { useEditorUiState } from '@/features/editor/state/ui-state'
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
  settingsComparison?: SettingsComparisonPresentation | null
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
  settingsComparison = null,
  active,
  additionalPlugins = NO_ADDITIONAL_PLUGINS,
  definitionTarget,
  document: suppliedDocument,
  paintKey,
  target,
  snapshot,
  onCaptureSourceChange,

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
  const { keymap } = useCommand()
  const [provisional, setProvisional] = useState(false)
  const [formattedDocument, setFormattedDocument] = useState<string | null>(null)
  const unavailable = useUnavailableEnvironment()
  const currentTarget = suppliedDocument?.target ?? target
  const key = suppliedDocument?.key ?? documentKey(target)
  const conflict = useEditorConflictState((state) =>
    target.kind === 'conflict' ? (state.conflicts[target.conflictId] ?? null) : null,
  )
  const seed =
    target.kind === 'conflict' &&
    suppliedDocument?.target.kind === 'conflict' &&
    suppliedDocument.target.conflictId === target.conflictId &&
    suppliedDocument.key === documentKey(target) &&
    conflict?.seed?.resolutionKey === suppliedDocument.key &&
    conflict.seed.buffer === suppliedDocument.buffer
      ? conflict.seed
      : null
  const [captureView, setCaptureView] = useState<{
    conflictId: string
    seed: NonNullable<FilesystemConflict['seed']>
    meaning: 'seed' | 'latest'
  } | null>(null)
  const comparison =
    captureView &&
    target.kind === 'conflict' &&
    captureView.conflictId === target.conflictId &&
    captureView.seed === seed &&
    conflict
      ? captureView
      : null
  if (captureView && !comparison) setCaptureView(null)
  const liveDocument = comparison ? null : suppliedDocument
  const restoreResolutionFocus = useRef<EditorRenderDocument | null>(null)
  // The native plugin registration keys its lifetime on this callback.
  const compareMergeConflict = useCallback(() => {
    if (!seed || target.kind !== 'conflict') return
    setCaptureView({ conflictId: target.conflictId, seed, meaning: 'seed' })
  }, [seed, target])
  const environmentId = useEditorDocumentState((state) => state.environmentId)
  const workspaceRoot = useEditorWorkspaceState((state) => state.rootFolder?.path ?? null)
  const settingsInput = settingsComparison?.read.input
  const admittedSettings =
    target.kind === 'settings-json' &&
    suppliedDocument?.target.kind === 'settings-json' &&
    suppliedDocument.target.target === target.target &&
    settingsInput &&
    settingsInput.key === documentKey(target) &&
    suppliedDocument.key === settingsInput.key &&
    settingsInput.target === target.target &&
    settingsInput.local.buffer === suppliedDocument.buffer &&
    settingsInput.scope.environmentId === environmentId &&
    workspaceRoot !== null &&
    rootPath === workspaceRoot &&
    settingsInput.scope.rootPath === workspaceRoot &&
    (!settingsComparison?.attachment ||
      (settingsInput.confirmed.kind === 'confirmed' &&
        settingsComparison.attachment.read === settingsComparison.read))
      ? settingsComparison
      : null
  const [shownSettings, setShownSettings] = useState<SettingsComparisonPresentation | null>(null)
  if (admittedSettings?.attachment && shownSettings !== admittedSettings)
    setShownSettings(admittedSettings)
  const heldSettings =
    shownSettings &&
    admittedSettings &&
    shownSettings.read.input.key === admittedSettings.read.input.key &&
    shownSettings.read.input.local.buffer === admittedSettings.read.input.local.buffer &&
    shownSettings.read.input.scope.environmentId ===
      admittedSettings.read.input.scope.environmentId &&
    shownSettings.read.input.scope.rootPath === admittedSettings.read.input.scope.rootPath
      ? shownSettings
      : null
  if (shownSettings && !heldSettings && !admittedSettings?.attachment) setShownSettings(null)
  const settingsDisplay = admittedSettings?.attachment ? admittedSettings : heldSettings
  const undoBarrierPlugin = useUndoBarrierPlugin(key)
  const resource = filesystemResource(currentTarget)
  const filePath = languageServerTarget?.matchPath ?? documentSourcePath(currentTarget) ?? ''
  const editability = unavailable || !liveDocument ? 'readonly' : liveDocument.editability
  const { appliedThemeContentHash, appliedThemeId, editorTheme, selectedThemeId } =
    useEditorColorTheme()
  const { analysisAllowed, minimapAllowed } = useDocumentFeatureTier(liveDocument?.buffer ?? null)
  const syntaxHighlightingEnabled =
    useSettingValue('editor.syntaxHighlighting.enabled') && analysisAllowed
  const indentationGuidesEnabled = useSettingValue('editor.guides.indentation') && analysisAllowed
  const minimapEnabled = useSettingValue('editor.minimap.enabled') && minimapAllowed
  const decodeSetting = useSettingValue('editor.decode.mode')
  const morphEnabled = useSettingValue('editor.morph.enabled') && analysisAllowed
  const inputRoute = useSettingValue('editor.inputRoute')
  const decodeMode = analysisAllowed
    ? effectiveDecodeMode(decodeSetting, typeof window === 'undefined' ? '' : location.search)
    : null
  const mountedEditors = useMountedEditorRegistry()
  const clearStatusBarSource = useEditorUiState((state) => state.clearStatusBarSource)
  const diagnosticPeek = useDiagnosticPeek({ active: active && !comparison, filePath })
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
        analysisAllowed,
        documentLanguageId,
      ),
    [
      analysisAllowed,
      appliedThemeContentHash,
      appliedThemeId,
      documentLanguageId,
      filePath,
      selectedThemeId,
      syntaxHighlightingEnabled,
    ],
  )
  const markdownView = useMarkdownView(key)
  const markdownPreview = documentLanguageId === 'markdown' && markdownView === 'preview'
  const openMarkdownLink = useMarkdownLinkOpener(filePath, rootPath)
  // useEditor keys native registration lifetime on this plugin array.
  const criticalEditorCorePlugins = useMemo(
    () =>
      createCriticalEditorCorePlugins(
        documentLanguageId,
        indentationGuidesEnabled,
        minimapEnabled,
        {
          analysisAllowed,
          syntaxHighlightingEnabled,
          compareMergeConflict: seed ? compareMergeConflict : undefined,
          markdownPreview,
          openMarkdownLink,
        },
      ),
    [
      analysisAllowed,
      documentLanguageId,
      indentationGuidesEnabled,
      markdownPreview,
      openMarkdownLink,
      minimapEnabled,
      syntaxHighlightingEnabled,
      seed,
      compareMergeConflict,
    ],
  )
  const motionPlugins = useMemo(
    () => createMotionPlugins(decodeMode, morphEnabled),
    [decodeMode, morphEnabled],
  )
  const unicodeHighlights = useUnicodeHighlights()
  const spellcheckPlugin = useSpellcheckPlugin()
  const textMenuRequest = useEditorUiState((state) =>
    state.textMenuRequest?.tabId === tabId ? state.textMenuRequest.count : null,
  )
  const pluginPrefix: readonly EditorPlugin[] = [undoBarrierPlugin]
  const plugins = pluginPrefix.concat(
    criticalEditorCorePlugins,
    [unicodeHighlights.plugin],
    analysisAllowed && spellcheckPlugin ? [spellcheckPlugin] : [],
    [diagnosticPeek.plugin, languageServer],
    motionPlugins,
    [scrollPersistencePlugin],
    additionalPlugins,
  )
  const document = liveDocument
    ? {
        documentId: liveDocument.key,
        buffer: liveDocument.buffer,
        analysis: liveDocument.analysis,
        ...preparedTags,
        languageId: documentLanguageId,
        preparedDocument: liveDocument.preparedDocument,
        text: '',
        view: liveDocument.view,
      }
    : null
  const typography = useEditorTypography()
  const gutterInset = useEditorGutterInset()
  const rowPositioning = editorPerformanceLayoutVariant() === 'absolute-rows' ? 'top' : 'transform'
  const controller = useEditor({
    cursorLineHighlight: {
      gutterNumber: true,
      gutterBackground: ['fold-gutter'],
      rowBackground: true,
    },
    document,
    folding: analysisAllowed,
    detectIndentation: analysisAllowed,
    documentKey: comparison ? null : paintKey,
    snapshot: !comparison && !decodeMode ? snapshot : null,
    editability,
    ...typography,
    gutterLeadingInset: gutterInset,
    inputRoute,
    keymapContext: { mode: 'full', extension: fileExtension(filePath) },
    hotkeys: keymap.hotkeys,
    hotkeysParent: keymap.parentFor(currentTarget.kind === 'settings-json' ? 'settings' : 'editor'),
    onChange: (_state, change) => {
      if (!liveDocument || !change || change.kind === 'selection' || change.kind === 'none') return

      onTextChange?.(tabId, key, change)
    },
    onInitialPaint: (event) => {
      if (comparison) return
      if (event.phase === 'highlight-settled') setFormattedDocument(event.documentId)
      onInitialPaint?.(event)
    },
    onPresentationChange: (state) => setProvisional(state === 'provisional'),
    plugins,
    rowPositioning,
    suspiciousCharacters: unicodeHighlights.options,
    theme: editorTheme,
  })
  useLayoutEffect(() => {
    // Decode changes visible text during its animation and has no replay contract.
    onCaptureSourceChange?.(
      comparison || decodeMode ? null : () => controller.getEditor()?.captureSnapshot() ?? null,
    )
    return () => onCaptureSourceChange?.(null)
  }, [comparison, controller, decodeMode, onCaptureSourceChange])
  const mountedPath = liveDocument ? resource?.path : undefined
  useRegisterEditorController(tabId, liveDocument ? controller : null)
  useLayoutEffect(
    () => (mountedPath ? mountedEditors.register(mountedPath) : undefined),
    [mountedPath, mountedEditors],
  )
  const settingsSurface = currentTarget.kind === 'settings-json'
  const preparingMarkdown =
    analysisAllowed &&
    markdownPreview &&
    syntaxHighlightingEnabled &&
    liveDocument !== null &&
    formattedDocument !== key &&
    !provisional
  const focusTarget = useEditorFocusTarget({
    controller,
    enabled: !comparison && !preparingMarkdown,
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
    if (comparison) {
      clearStatusBarSource(controller)
      return
    }
    if (!active || !liveDocument) return

    onStatusSourceChange?.({
      controller,
      filePath,
      languageServerStatusSource,
    })
  }, [
    active,
    comparison,
    clearStatusBarSource,
    controller,
    languageServerStatusSource,
    filePath,
    liveDocument,
    onStatusSourceChange,
  ])

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

  useEffect(() => {
    const requested = restoreResolutionFocus.current
    if (!requested || !liveDocument || !active) return
    restoreResolutionFocus.current = null
    if (
      requested.key !== documentKey(target) ||
      requested.key !== liveDocument.key ||
      requested.buffer !== liveDocument.buffer ||
      requested.view !== liveDocument.view
    )
      return
    controller.commands.focus()
  }, [active, controller, liveDocument, target])

  if (comparison && conflict) {
    const retained: RetainedFilesystemComparison =
      comparison.meaning === 'seed' ? comparison.seed.comparison : conflict.latest
    const attachment = filesystemDiffAttachment(retained.lease.read(), comparison.meaning)
    return (
      <div className='flex h-full min-h-0 min-w-0 flex-col'>
        <PaneBar>
          <Button
            variant='ghost'
            size='sm'
            aria-pressed={comparison.meaning === 'seed'}
            onClick={() => setCaptureView({ ...comparison, meaning: 'seed' })}
          >
            Original comparison
          </Button>
          <Button
            variant='ghost'
            size='sm'
            aria-pressed={comparison.meaning === 'latest'}
            onClick={() => setCaptureView({ ...comparison, meaning: 'latest' })}
          >
            Latest incoming
          </Button>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => {
              restoreResolutionFocus.current = suppliedDocument
              setCaptureView(null)
            }}
          >
            Resolution
          </Button>
        </PaneBar>
        <div className='min-h-0 min-w-0 flex-1'>
          {attachment ? (
            <DiffEditor attachment={attachment} mode='stacked' tabId={tabId} />
          ) : (
            <EmptyState
              title='Capture unavailable'
              description='Return to the resolution to continue editing.'
            />
          )}
        </div>
      </div>
    )
  }

  // The notice is a row under the frame, so it never covers the last lines of the document.
  return (
    <>
      {admittedSettings ? (
        <div
          className='flex h-48 min-h-0 shrink-0 flex-col overflow-hidden'
          role='region'
          aria-label='Settings comparison'
        >
          <PaneBar>
            <span className='text-xs font-medium'>Your edits</span>
            <span className='text-xs font-medium'>Latest version</span>
            {!admittedSettings.attachment ? (
              <Spinner size='xs' label='Loading confirmed comparison' />
            ) : null}
          </PaneBar>
          <div className='min-h-0 flex-1'>
            {settingsDisplay?.attachment ? (
              <DiffEditor attachment={settingsDisplay.attachment} mode='stacked' />
            ) : (
              <div className='flex h-full items-center justify-center'>
                <Spinner size='sm' label='Loading comparison' />
              </div>
            )}
          </div>
        </div>
      ) : null}
      <EditorFrame
        active={active && focusTarget.focused}
        controller={controller}
        preparing={preparingMarkdown}
        onRequestCloseOverlay={diagnosticPeek.snapshot ? diagnosticPeek.close : undefined}
        targetRef={focusTarget.ref}
        textMenuRequest={textMenuRequest}
      >
        {(provisional || preparingMarkdown) && liveDocument ? (
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
      {liveDocument ? (
        <LargeFileNotice analysisAllowed={analysisAllowed} minimapAllowed={minimapAllowed} />
      ) : null}
    </>
  )
}
