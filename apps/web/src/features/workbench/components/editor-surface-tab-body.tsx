import { documentKey } from '@/lib/documents/utils/identity'
import { filesystemResource } from '@/lib/documents/utils/capabilities'
import type { DocumentKey, FilesystemPath, TabContent, TabId } from '@/lib/documents/utils/types'
import { useCallback, useEffect, useLayoutEffect, useMemo } from 'react'

import {
  joinedEditorRenderDocument,
  readyFile,
} from '@/features/workspace/utils/editor-render-document'
import { useConflictEditorResolution } from '@/features/workspace/hooks/use-conflict-editor-resolution'
import { SearchPane } from '@/features/workspace/components/search-pane'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { useEditorDocumentState } from '@/features/editor/state/document-state'
import { useWorkspaceEditHost } from '@/features/editor/providers/workspace-edit-context'
import { useEditorUiState, useEditorUiStoreApi } from '@/features/editor/state/ui-state'
import { FileEditorBody } from '@/features/workbench/components/file-editor-body'
import {
  EditorSurfaceActionsContext,
  type EditorSurfaceActions,
} from '@/features/workbench/providers/editor-surface-actions-context'
import { SettingsPage } from '@/features/settings/components/page'
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

  content,
  rootPath,
  tabId,
}: {
  active: boolean
  definitionTarget?: LanguageServerDefinitionTarget

  content: TabContent
  rootPath: FilesystemPath
  tabId: TabId
}) {
  useSettingsJsonDocument(tabId, content)
  const target = content.kind === 'document' ? content.document : null
  const selectedConflict = target?.kind === 'conflict' ? target : null
  const selectedReference = target?.kind === 'git-ref' ? target : null
  const resource = filesystemResource(target)
  const { fileState, fileVersion } = useSelectedFile(resource?.path ?? null)
  const { service: fileOpenIntent } = useFileOpenIntent()
  const selectedViewDocumentKey = useEditorDocumentState(
    (state) => state.viewsByTabId[tabId]?.documentKey ?? null,
  )
  const selectedViewSession = useEditorDocumentState(
    (state) => state.viewsByTabId[tabId]?.view ?? null,
  )
  const selectedPreparedDocument = useEditorDocumentState(
    (state) => state.viewsByTabId[tabId]?.preparedDocument ?? null,
  )
  const selectedDocumentBuffer = useEditorDocumentState((state) =>
    selectedViewDocumentKey
      ? (state.liveDocumentsByKey[selectedViewDocumentKey]?.buffer ?? null)
      : null,
  )
  const selectedDocumentTarget = useEditorDocumentState((state) =>
    selectedViewDocumentKey
      ? (state.liveDocumentsByKey[selectedViewDocumentKey]?.target ?? null)
      : null,
  )
  const selectedDocumentEditability = useEditorDocumentState((state) => {
    if (!selectedViewDocumentKey) return 'editable'
    const document = state.liveDocumentsByKey[selectedViewDocumentKey]
    return document?.sync.kind === 'recovery-conflict' ? 'readonly' : 'editable'
  })
  const selectedLiveDocument = useMemo(
    () =>
      joinedEditorRenderDocument({
        buffer: selectedDocumentBuffer,
        documentKey: selectedViewDocumentKey,
        editability: selectedDocumentEditability,
        target: selectedDocumentTarget,
        preparedDocument: selectedPreparedDocument,
        view: selectedViewSession,
      }),
    [
      selectedDocumentBuffer,
      selectedDocumentEditability,
      selectedDocumentTarget,
      selectedPreparedDocument,
      selectedViewDocumentKey,
      selectedViewSession,
    ],
  )
  const ensureEditorView = useEditorDocumentState((state) => state.ensureEditorView)
  const ensureEditorViewForDocument = useEditorDocumentState(
    (state) => state.ensureEditorViewForDocument,
  )
  const getLiveEditorDocument = useEditorDocumentState((state) => state.getLiveEditorDocument)
  const setEditorViewScrollPosition = useEditorDocumentState(
    (state) => state.setEditorViewScrollPosition,
  )
  const uiDefinitionTarget = useEditorUiState((state) => state.definitionTarget)
  const languageServerReferences = useEditorUiState((state) => state.languageServerReferences)
  const setLanguageServerReferences = useEditorUiState((state) => state.setLanguageServerReferences)
  const clearStatusBarSource = useEditorUiState((state) => state.clearStatusBarSource)
  const setStatusBarSource = useEditorUiState((state) => state.setStatusBarSource)
  const uiStore = useEditorUiStoreApi()
  const { openDefinition } = useEditorCommands()
  const applyWorkspaceEdit = useWorkspaceEditHost()
  const resolveConflictEditorDocument = useConflictEditorResolution()
  const selectedFile = readyFile(fileState)

  useLayoutEffect(() => {
    if (!selectedFile) return

    const claim = fileOpenIntent.claimReadyClean(selectedFile.path)
    ensureEditorView(tabId, selectedFile, claim)
  }, [ensureEditorView, fileOpenIntent, selectedFile, tabId])

  useEffect(() => {
    if (!target || (!selectedConflict && !selectedReference)) return
    const key = documentKey(target)
    if (!getLiveEditorDocument(key)) return
    ensureEditorViewForDocument(tabId, key)
  }, [
    ensureEditorViewForDocument,
    getLiveEditorDocument,
    target,
    selectedConflict,
    selectedReference,
    tabId,
  ])

  useEffect(() => {
    if (!active) return
    if (selectedLiveDocument) return
    if (fileState.status === 'ready') return

    clearStatusBarSource()
  }, [active, clearStatusBarSource, fileState.status, selectedLiveDocument])

  const handleEditorTextChange = useCallback(
    (_sourceTabId: TabId, changedKey: DocumentKey, change: DocumentSessionChange) => {
      if (!selectedConflict || changedKey !== documentKey(selectedConflict)) return
      resolveConflictEditorDocument(selectedConflict, change.textSnapshot)
    },
    [resolveConflictEditorDocument, selectedConflict],
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
      openDefinition: (target) => {
        void openDefinition(target)
      },
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
  if (content.kind === 'settings') {
    return <SettingsPage liveDocument={selectedLiveDocument} rootPath={rootPath} tabId={tabId} />
  }

  if (target?.kind === 'search') {
    return <SearchPane compact={false} rootPath={target.root} />
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
        target={content.document}
        rootPath={rootPath}
        tabId={tabId}
      />
    </EditorSurfaceActionsContext>
  )
}
