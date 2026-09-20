import { documentKey } from '@/lib/documents/utils/identity'
import { filesystemResource } from '@/lib/documents/utils/capabilities'
import type { FilesystemPath, StandaloneDocumentRef, TabId } from '@/lib/documents/utils/types'
import { useEditorRuntime } from '@/features/editor/hooks/use-runtime'
import { WarningCircleIcon } from '@phosphor-icons/react'

import { CompareSavedView } from '@/features/editor/components/compare-saved-view'
import { HistoryView } from '@/features/editor/components/history-view'
import { Editor } from '@/features/editor/components/editor'
import { useEditorColorTheme } from '@/features/editor/hooks/use-editor-color-theme'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import { LanguageServerReferencesPane } from '@/features/editor/components/language-server-references-pane'
import type { EditorRenderDocument } from '@/features/editor/utils/render-document'
import { DiffView } from '@/features/git/components/diff-view'
import { useEditorSurfaceActions } from '@/features/workbench/hooks/use-editor-surface-actions'
import { useEditorVisibleSnapshot } from '@/features/workbench/hooks/use-editor-visible-snapshot'
import { useFileOpenIntent } from '@/lib/file-open-intent/providers/context'
import type { FileResult } from '@/lib/file-system-types'
import type { LoadState } from '@/lib/load-state'
import type { EditorInitialPaintEvent } from '@singapore-editor/core'
import type {
  LanguageServerDefinitionTarget,
  LanguageServerReferencesResult,
} from '@singapore-editor/lsp-plugin'

export function FileEditorBody({
  active,
  liveDocument,
  definitionTarget,

  fileState,
  fileVersion,
  languageServerReferences,
  target,
  rootPath,
  tabId,
}: {
  active: boolean
  liveDocument: EditorRenderDocument | null
  definitionTarget: LanguageServerDefinitionTarget | null

  fileState: LoadState<FileResult>
  fileVersion: string | null
  languageServerReferences: LanguageServerReferencesResult | null
  target: StandaloneDocumentRef
  rootPath: FilesystemPath
  tabId: TabId
}) {
  const { storage } = useEditorRuntime()
  const actions = useEditorSurfaceActions()
  const { service: fileOpenIntent } = useFileOpenIntent()
  const comparison = target.kind === 'git-diff' ? target.source : null
  const comparePath = target.kind === 'compare-saved' ? target.file.path : null
  const historyPath = target.kind === 'history' ? target.file.path : null
  const resource = filesystemResource(target)
  const key = documentKey(target)
  const editorDocument = liveDocument?.key === key ? liveDocument : null
  const ownsCurrentTab = editorDocument !== null
  const currentActions = ownsCurrentTab ? actions : null
  const currentReferences = currentActions ? languageServerReferences : null
  const { appliedThemeId, committedThemeId, selectedThemeId } = useEditorColorTheme()
  const snapshotActive = active && resource !== null
  const visibleSnapshot = useEditorVisibleSnapshot({
    storage,
    active: snapshotActive,
    documentKey: key,
    renderedDocument:
      editorDocument && resource
        ? {
            buffer: editorDocument.buffer,
            documentKey: editorDocument.key,
            path: resource.path,
            rootPath,
          }
        : null,
    selectedTarget: resource
      ? { contentVersion: fileVersion, path: resource.path, rootPath }
      : null,
    theme: { appliedThemeId, committedThemeId, selectedThemeId },
  })

  function recordInitialPaint(event: EditorInitialPaintEvent) {
    if (resource) fileOpenIntent.recordInitialPaint(resource.path, event)
  }

  if (comparison) {
    return (
      <DiffView comparison={comparison} languageHost={actions} rootPath={rootPath} tabId={tabId} />
    )
  }

  if (historyPath) {
    return (
      <HistoryView path={historyPath} tabId={tabId} onLeave={() => actions.showFile(historyPath)} />
    )
  }

  if (comparePath) {
    return (
      <CompareSavedView
        languageHost={actions}
        path={comparePath}
        rootPath={rootPath}
        tabId={tabId}
      />
    )
  }

  return (
    <div
      className={
        currentReferences
          ? 'grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_minmax(260px,340px)] grid-rows-[minmax(0,1fr)] overflow-hidden'
          : 'grid h-full min-h-0 min-w-0 grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden'
      }
    >
      <div className='relative min-h-0 min-w-0 overflow-hidden'>
        <Editor
          active={active && currentActions !== null}
          additionalPlugins={visibleSnapshot.additionalPlugins}
          definitionTarget={currentActions ? definitionTarget : null}
          document={editorDocument}
          paintKey={visibleSnapshot.paintKey}
          target={target}
          snapshot={visibleSnapshot.snapshot}
          onCaptureSourceChange={visibleSnapshot.onCaptureSourceChange}
          rootPath={rootPath}
          tabId={tabId}
          onInitialPaint={recordInitialPaint}
          onScrollPositionChange={
            currentActions
              ? (changedKey, scrollPosition, reopenScrollPosition) => {
                  if (changedKey !== key) return

                  currentActions.setScrollPosition(scrollPosition, reopenScrollPosition)
                }
              : undefined
          }
          onStatusSourceChange={currentActions?.setStatusSource}
          onTextChange={currentActions?.handleTextChange}
          onOpenDefinition={currentActions?.openDefinition}
          onOpenReferences={currentActions?.openReferences}
          onCompareMergeConflict={currentActions?.compareMergeConflict ?? undefined}
        />
        {fileState.status === 'error' ? (
          <div
            role='status'
            className='bg-background text-muted-foreground absolute inset-x-0 bottom-0 flex items-center gap-2 px-3 py-2 text-xs'
          >
            <WarningCircleIcon className='size-4 shrink-0' />
            {fileState.message}
          </div>
        ) : null}
        {!editorDocument && fileState.status !== 'error' ? (
          <div className='bg-background text-muted-foreground absolute inset-x-0 bottom-0 flex items-center gap-2 px-3 py-2 text-xs'>
            <OrbitLoader className='size-3' label='Loading file' />
            Loading file…
          </div>
        ) : null}
      </div>
      {currentReferences && currentActions ? (
        <LanguageServerReferencesPane
          references={currentReferences}
          rootPath={rootPath}
          onClose={currentActions.closeReferences}
          onOpenReference={currentActions.openDefinition}
          onPreviewReference={currentActions.previewReference}
        />
      ) : null}
    </div>
  )
}
