import { useEditorRuntime } from '@/features/editor/hooks/use-runtime'
import { WarningCircleIcon } from '@phosphor-icons/react'

import { CompareSavedView } from '@/features/editor/components/compare-saved-view'
import { parseCompareSavedDocumentId } from '@/features/editor/utils/compare-saved-document'
import { Editor } from '@/features/editor/components/editor'
import { useEditorColorTheme } from '@/features/editor/hooks/use-editor-color-theme'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import { LanguageServerReferencesPane } from '@/features/editor/components/language-server-references-pane'
import type { EditorRenderDocument } from '@/features/editor/utils/render-document'
import { DiffView } from '@/features/git/components/diff-view'
import { parseDiffDocumentId } from '@/features/git/utils/diff-document'
import { useEditorSurfaceActions } from '@/features/workbench/hooks/use-editor-surface-actions'
import { useEditorVisibleSnapshot } from '@/features/workbench/hooks/use-editor-visible-snapshot'
import { useFileOpenIntent } from '@/lib/file-open-intent/providers/context'
import type { FileResult } from '@/lib/file-system-types'
import type { LoadState } from '@/lib/load-state'
import type { EditorInitialPaintEvent } from '@singapor/core'
import type {
  LanguageServerDefinitionTarget,
  LanguageServerReferencesResult,
} from '@singapor/lsp-plugin'

export function FileEditorBody({
  active,
  liveDocument,
  definitionTarget,

  fileState,
  fileVersion,
  languageServerReferences,
  path,
  rootPath,
  tabId,
}: {
  active: boolean
  liveDocument: EditorRenderDocument | null
  definitionTarget: LanguageServerDefinitionTarget | null

  fileState: LoadState<FileResult>
  fileVersion: string | null
  languageServerReferences: LanguageServerReferencesResult | null
  path: string
  rootPath: string
  tabId: string
}) {
  const { storage } = useEditorRuntime()
  const actions = useEditorSurfaceActions()
  const { service: fileOpenIntent } = useFileOpenIntent()
  const diffDocument = parseDiffDocumentId(path)
  const comparePath = parseCompareSavedDocumentId(path)
  const editorDocument = liveDocument?.path === path ? liveDocument : null
  const ownsCurrentTab = editorDocument !== null
  const currentActions = ownsCurrentTab ? actions : null
  const currentReferences = currentActions ? languageServerReferences : null
  const { appliedThemeId, committedThemeId, selectedThemeId } = useEditorColorTheme()
  const snapshotActive = active && !diffDocument && !comparePath
  const visibleSnapshot = useEditorVisibleSnapshot({
    storage,
    active: snapshotActive,
    renderedDocument: editorDocument
      ? {
          buffer: editorDocument.buffer,
          documentId: editorDocument.id,
          path: editorDocument.path,
          rootPath,
        }
      : null,
    selectedTarget: { contentVersion: fileVersion, path, rootPath },
    theme: { appliedThemeId, committedThemeId, selectedThemeId },
  })

  function recordInitialPaint(event: EditorInitialPaintEvent) {
    fileOpenIntent.recordInitialPaint(path, event)
  }

  if (diffDocument) {
    return (
      <DiffView
        documentInfo={diffDocument}
        languageHost={actions}
        rootPath={rootPath}
        tabId={tabId}
      />
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
          documentKey={visibleSnapshot.documentKey}
          path={path}
          snapshot={visibleSnapshot.snapshot}
          onCaptureSourceChange={visibleSnapshot.onCaptureSourceChange}
          rootPath={rootPath}
          tabId={tabId}
          onInitialPaint={recordInitialPaint}
          onScrollPositionChange={
            currentActions
              ? (changedPath, scrollPosition) => {
                  if (changedPath !== path) return

                  currentActions.setScrollPosition(scrollPosition)
                }
              : undefined
          }
          onStatusSourceChange={currentActions?.setStatusSource}
          onTextChange={currentActions?.handleTextChange}
          onOpenDefinition={currentActions?.openDefinition}
          onOpenReferences={currentActions?.openReferences}
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
