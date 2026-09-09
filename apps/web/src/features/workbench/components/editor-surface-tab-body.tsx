import { useCallback, useEffect, useLayoutEffect, useMemo } from 'react'

import {
  joinedEditorRenderDocument,
  readyFile,
} from '@/features/workspace/utils/editor-render-document'
import { useConflictEditorResolution } from '@/features/workspace/hooks/use-conflict-editor-resolution'
import { SearchPane } from '@/features/workspace/components/search-pane'
import { parseConflictDiffDocumentId } from '@/features/editor/utils/conflict-diff-document'
import { useEditorCommands } from '@/features/editor/state/commands'
import { useEditorDocumentState } from '@/features/editor/state/document-state'
import { useWorkspaceEditHost } from '@/features/editor/providers/workspace-edit-context'
import { useEditorUiState, useEditorUiStoreApi } from '@/features/editor/state/ui-state'
import { FileEditorBody } from '@/features/workbench/components/file-editor-body'
import {
  EditorSurfaceActionsContext,
  type EditorSurfaceActions,
} from '@/features/workbench/providers/editor-surface-actions-context'
import { parseRefDocumentId } from '@/features/git/utils/ref-document'
import { parseSearchBufferDocumentId } from '@/features/search/utils/buffer-document'
import { SettingsPage } from '@/features/settings/components/page'
import { isSettingsDocumentId } from '@/features/settings/utils/document'
import { useSettingsJsonDocument } from '@/features/settings/hooks/use-settings-json-document'
import { useSelectedFile } from '@/features/workspace/hooks/use-selected-file'
import type { DocumentSessionChange } from '@singapor/core'
import type {
  LanguageServerDefinitionTarget,
  LanguageServerReferencesResult,
} from '@singapor/lsp-plugin'
import { useFileOpenIntent } from '@/lib/file-open-intent/providers/context'

export function EditorSurfaceTabBody({
  active,
  definitionTarget,

  path,
  rootPath,
  tabId,
}: {
  active: boolean
  definitionTarget?: LanguageServerDefinitionTarget

  path: string
  rootPath: string
  tabId: string
}) {
  // Above every early exit, like the rest of the hooks here. No-ops unless this
  // is the settings tab showing its JSON view.
  useSettingsJsonDocument(tabId, path)
  const selectedConflictDiff = useMemo(() => parseConflictDiffDocumentId(path), [path])
  const selectedSearchBuffer = useMemo(() => parseSearchBufferDocumentId(path), [path])
  const selectedRefDocument = useMemo(() => parseRefDocumentId(path), [path])
  const { fileState, fileVersion } = useSelectedFile(
    selectedConflictDiff || selectedSearchBuffer || selectedRefDocument ? null : path,
  )
  const { service: fileOpenIntent } = useFileOpenIntent()
  const selectedViewDocumentId = useEditorDocumentState(
    (state) => state.viewsByTabId[tabId]?.documentId ?? null,
  )
  const selectedViewSession = useEditorDocumentState(
    (state) => state.viewsByTabId[tabId]?.view ?? null,
  )
  const selectedPreparedDocument = useEditorDocumentState(
    (state) => state.viewsByTabId[tabId]?.preparedDocument ?? null,
  )
  const selectedDocumentBuffer = useEditorDocumentState((state) =>
    selectedViewDocumentId
      ? (state.liveDocumentsById[selectedViewDocumentId]?.buffer ?? null)
      : null,
  )
  const selectedDocumentPath = useEditorDocumentState((state) =>
    selectedViewDocumentId ? (state.liveDocumentsById[selectedViewDocumentId]?.path ?? null) : null,
  )
  const selectedDocumentEditability = useEditorDocumentState((state) => {
    if (!selectedViewDocumentId) return 'editable'
    const document = state.liveDocumentsById[selectedViewDocumentId]
    return document?.sync.kind === 'recovery-conflict' ? 'readonly' : 'editable'
  })
  const selectedLiveDocument = useMemo(
    () =>
      joinedEditorRenderDocument({
        buffer: selectedDocumentBuffer,
        documentId: selectedViewDocumentId,
        editability: selectedDocumentEditability,
        path: selectedDocumentPath,
        preparedDocument: selectedPreparedDocument,
        view: selectedViewSession,
      }),
    [
      selectedDocumentBuffer,
      selectedDocumentEditability,
      selectedDocumentPath,
      selectedPreparedDocument,
      selectedViewDocumentId,
      selectedViewSession,
    ],
  )
  const ensureEditorView = useEditorDocumentState((state) => state.ensureEditorView)
  const ensureEditorViewForDocument = useEditorDocumentState(
    (state) => state.ensureEditorViewForDocument,
  )
  const getLiveEditorDocument = useEditorDocumentState((state) => state.getLiveEditorDocument)
  const forceReplaceLiveEditorDocument = useEditorDocumentState(
    (state) => state.forceReplaceLiveEditorDocument,
  )
  const setEditorViewScrollPosition = useEditorDocumentState(
    (state) => state.setEditorViewScrollPosition,
  )
  const uiDefinitionTarget = useEditorUiState((state) => state.definitionTarget)
  const languageServerReferences = useEditorUiState((state) => state.languageServerReferences)
  const setLanguageServerReferences = useEditorUiState((state) => state.setLanguageServerReferences)
  const clearStatusBarSource = useEditorUiState((state) => state.clearStatusBarSource)
  const setStatusBarSource = useEditorUiState((state) => state.setStatusBarSource)
  const uiStore = useEditorUiStoreApi()
  const { discardLiveEditorDocument, openDefinition, renameLiveEditorDocument } =
    useEditorCommands()
  const applyWorkspaceEdit = useWorkspaceEditHost()
  const resolveConflictEditorDocument = useConflictEditorResolution({
    discardLiveEditorDocument,
    forceReplaceLiveEditorDocument,
    renameLiveEditorDocument,
  })
  const selectedFile = selectedConflictDiff ? null : readyFile(fileState)

  useLayoutEffect(() => {
    if (!selectedFile) return

    const claim = fileOpenIntent.claimReadyClean(selectedFile.path)
    ensureEditorView(tabId, selectedFile, claim)
  }, [ensureEditorView, fileOpenIntent, selectedFile, tabId])

  // Conflict and git-ref tabs both own an unsynced document rather than a file, so they attach a
  // view by document id instead of going through the file path.
  useEffect(() => {
    if (!selectedConflictDiff && !selectedRefDocument) return
    if (!getLiveEditorDocument(path)) return

    ensureEditorViewForDocument(tabId, path)
  }, [
    ensureEditorViewForDocument,
    getLiveEditorDocument,
    path,
    selectedConflictDiff,
    selectedRefDocument,
    tabId,
  ])

  useEffect(() => {
    if (!active) return
    if (path && selectedLiveDocument) return
    if (path && fileState.status === 'ready') return

    clearStatusBarSource()
  }, [active, clearStatusBarSource, fileState.status, path, selectedLiveDocument])

  const handleEditorTextChange = useCallback(
    (_sourceTabId: string, changedPath: string, change: DocumentSessionChange) => {
      resolveConflictEditorDocument(changedPath, change.textSnapshot)
    },
    [resolveConflictEditorDocument],
  )
  const handleOpenReferences = useCallback(
    (result: LanguageServerReferencesResult) => {
      setLanguageServerReferences(result)
      return true
    },
    [setLanguageServerReferences],
  )
  const handlePreviewDefinition = useCallback(
    (target: LanguageServerDefinitionTarget) => {
      uiStore.getState().setDefinitionTarget(target)
    },
    [uiStore],
  )
  const handleCloseReferences = useCallback(
    () => setLanguageServerReferences(null),
    [setLanguageServerReferences],
  )
  // This is a bound workbench action surface; Editor still receives explicit plugin callbacks.
  const editorSurfaceActions = useMemo<EditorSurfaceActions>(
    () => ({
      applyWorkspaceEdit,
      closeReferences: handleCloseReferences,
      openDefinition,
      openReferences: handleOpenReferences,
      previewReference: handlePreviewDefinition,
      handleTextChange: handleEditorTextChange,
      setScrollPosition: (scrollPosition) => setEditorViewScrollPosition(tabId, scrollPosition),
      setStatusSource: setStatusBarSource,
    }),
    [
      applyWorkspaceEdit,
      handleCloseReferences,
      handleEditorTextChange,
      handleOpenReferences,
      handlePreviewDefinition,
      openDefinition,
      setEditorViewScrollPosition,
      setStatusBarSource,
      tabId,
    ],
  )

  // Before the file paths: a settings tab has no document, no language server
  // and nothing to save, so falling through to the editor machinery would only
  // give it a spinner for a file that does not exist.
  if (isSettingsDocumentId(path)) {
    return <SettingsPage liveDocument={selectedLiveDocument} rootPath={rootPath} tabId={tabId} />
  }

  if (selectedSearchBuffer) {
    return <SearchPane compact={false} rootPath={selectedSearchBuffer.rootPath} />
  }

  return (
    <EditorSurfaceActionsContext value={editorSurfaceActions}>
      <FileEditorBody
        active={active}
        liveDocument={selectedLiveDocument}
        definitionTarget={definitionTarget ?? (active ? uiDefinitionTarget : null)}
        fileState={fileState}
        fileVersion={fileVersion}
        languageServerReferences={active ? languageServerReferences : null}
        path={path}
        rootPath={rootPath}
        tabId={tabId}
      />
    </EditorSurfaceActionsContext>
  )
}
