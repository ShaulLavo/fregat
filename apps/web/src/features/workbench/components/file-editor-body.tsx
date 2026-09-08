import { useEditorRuntime } from '@/features/editor/hooks/use-runtime'
import { WarningCircleIcon } from '@phosphor-icons/react'

import { CompareSavedView } from '@/features/editor/components/compare-saved-view'
import { parseCompareSavedDocumentId } from '@/features/editor/utils/compare-saved-document'
import { Editor } from '@/features/editor/components/editor'
import { useEditorColorTheme } from '@/features/editor/hooks/use-editor-color-theme'
import { useSettingValue } from '@/features/settings/hooks/use-setting-value'
import { LanguageServerReferencesPane } from '@/features/editor/components/language-server-references-pane'
import type { EditorRenderDocument } from '@/features/editor/utils/render-document'
import { DiffView } from '@/features/git/components/diff-view'
import { parseDiffDocumentId } from '@/features/git/utils/diff-document'
import { useEditorSurfaceActions } from '@/features/workbench/hooks/use-editor-surface-actions'
import { useEditorVisibleSnapshot } from '@/features/workbench/hooks/use-editor-visible-snapshot'
import { useHeldLiveDocument } from '@/features/workbench/hooks/use-held-live-document'
import { EditorVisibleSnapshot } from '@/features/workbench/components/editor-visible-snapshot'
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
  const indentationGuidesEnabled = useSettingValue('editor.guides.indentation')
  const actions = useEditorSurfaceActions()
  const { service: fileOpenIntent } = useFileOpenIntent()
  // Neither a diff nor a compare document is file-backed, so neither can own a live editor
  // document. Both are parsed before the hook below, which has to run above every early exit.
  const diffDocument = parseDiffDocumentId(path)
  const comparePath = parseCompareSavedDocumentId(path)
  const displayedDocument = useHeldLiveDocument(
    liveDocument,
    !diffDocument && !comparePath && isSettling(fileState),
  )
  const editorDocument = displayedDocument.document
  const ownsCurrentTab = displayedDocument.current && editorDocument?.path === path
  const currentActions = ownsCurrentTab ? actions : null
  const currentReferences = currentActions ? languageServerReferences : null
  const { appliedThemeId, committedThemeId, selectedThemeId } = useEditorColorTheme()
  const snapshotActive = active && !diffDocument && !comparePath
  const visibleSnapshot = useEditorVisibleSnapshot({
    storage,
    active: snapshotActive,
    fileReadError: fileState.status === 'error',
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

  function dismissVisibleSnapshot() {
    visibleSnapshot.dismissOverlay()
  }

  function recordInitialPaint(event: EditorInitialPaintEvent) {
    visibleSnapshot.onInitialPaint(event)
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

  if (editorDocument) {
    return (
      <div
        className={
          currentReferences
            ? 'grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_minmax(260px,340px)] grid-rows-[minmax(0,1fr)] overflow-hidden'
            : 'grid h-full min-h-0 min-w-0 grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden'
        }
      >
        <div
          className='relative min-h-0 min-w-0 overflow-hidden has-[>[data-editor-visible-snapshot]:not([hidden])]:[&>[data-editor-focus-active]]:opacity-0'
          onFocusCapture={dismissVisibleSnapshot}
          onKeyDownCapture={dismissVisibleSnapshot}
          onPointerDownCapture={dismissVisibleSnapshot}
          onTouchMoveCapture={dismissVisibleSnapshot}
          onWheelCapture={dismissVisibleSnapshot}
        >
          <Editor
            active={active && currentActions !== null}
            additionalPlugins={visibleSnapshot.additionalPlugins}
            definitionTarget={currentActions ? definitionTarget : null}
            document={editorDocument}
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
          {visibleSnapshot.record ? (
            <EditorVisibleSnapshot
              indentationGuidesEnabled={indentationGuidesEnabled}
              overlayRef={visibleSnapshot.overlayRef}
              record={visibleSnapshot.record}
            />
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

  if (fileState.status === 'error') {
    return (
      <div className='text-muted-foreground flex min-h-0 items-center justify-center p-6 text-xs'>
        <WarningCircleIcon className='mr-2 size-4' />
        {fileState.message}
      </div>
    )
  }

  if (visibleSnapshot.record) {
    return (
      <div
        className='relative h-full min-h-0 w-full min-w-0 overflow-hidden'
        onFocusCapture={dismissVisibleSnapshot}
        onKeyDownCapture={dismissVisibleSnapshot}
        onPointerDownCapture={dismissVisibleSnapshot}
        onTouchMoveCapture={dismissVisibleSnapshot}
        onWheelCapture={dismissVisibleSnapshot}
      >
        <EditorVisibleSnapshot
          indentationGuidesEnabled={indentationGuidesEnabled}
          overlayRef={visibleSnapshot.overlayRef}
          record={visibleSnapshot.record}
        />
      </div>
    )
  }

  return null
}

/** A tab with a file on the way keeps the last document; an empty or failed one has nothing to wait for. */
function isSettling(fileState: LoadState<FileResult>): boolean {
  return fileState.status === 'loading' || fileState.status === 'ready'
}
