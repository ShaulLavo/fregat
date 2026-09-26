import { useMemo, useState } from 'react'
import { documentKey } from '@/lib/documents/utils/identity'
import { MarkdownPreviewPane } from '@/features/workbench/components/markdown-preview-pane'
import { createMarkdownScrollSync } from '@/features/workbench/state/markdown-scroll-sync'
import { fileBodyGridClass } from '@/features/workbench/utils/file-body-grid'
import { useMarkdownView } from '@/lib/markdown-mode/hooks/use-markdown-view'
import { isMarkdownPath } from '@/lib/markdown-mode/utils/mode'
import { filesystemResource } from '@/lib/documents/utils/capabilities'
import type { FilesystemPath, StandaloneDocumentRef, TabId } from '@/lib/documents/utils/types'
import { useEditorRuntime } from '@/features/editor/hooks/use-runtime'
import { FileLoadError } from '@/features/workbench/components/file-load-error'

import { CompareSavedView } from '@/features/editor/components/compare-saved-view'
import { HistoryView } from '@/features/editor/components/history-view'
import { Editor } from '@/features/editor/components/editor'
import { useEditorColorTheme } from '@/lib/editor-theme/hooks/use-editor-color-theme'
import { Spinner } from '@workspace/ui/components/spinner'
import { LanguageServerReferencesPane } from '@/features/editor/components/language-server-references-pane'
import type { EditorRenderDocument } from '@/features/editor/utils/render-document'
import { DiffView } from '@/features/git/components/diff-view'
import { useEditorSurfaceActions } from '@/features/workbench/hooks/use-editor-surface-actions'
import { useEditorVisibleSnapshot } from '@/features/workbench/hooks/use-editor-visible-snapshot'
import { useFileOpenIntent } from '@/lib/file-open-intent/providers/context'
import { notePressPaint } from '@/lib/intent-prefetch/state/press-paint'
import type { FileResult } from '@/lib/file-system-types'
import type { LoadState } from '@/lib/load-state'
import type { EditorInitialPaintEvent } from '@singapore-editor/core/extensions'
import type { LanguageServerDefinitionTarget } from '@singapore-editor/lsp-plugin/websocket'
import type { LanguageServerReferencesResult } from '@singapore-editor/lsp-plugin'

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

  const markdownView = useMarkdownView(key)
  const splitMarkdown =
    markdownView === 'split' &&
    editorDocument !== null &&
    resource !== null &&
    isMarkdownPath(resource.path)
  const [scrollSync] = useState(createMarkdownScrollSync)
  // Manual memo: plugin identity is the editor's registration lifetime; a new array re-registers
  // every plugin on each render.
  const editorPlugins = useMemo(
    () =>
      splitMarkdown
        ? [...visibleSnapshot.additionalPlugins, scrollSync.plugin]
        : visibleSnapshot.additionalPlugins,
    [scrollSync, splitMarkdown, visibleSnapshot.additionalPlugins],
  )

  function recordInitialPaint(event: EditorInitialPaintEvent) {
    if (!resource) return
    fileOpenIntent.recordInitialPaint(resource.path, event)
    if (event.phase === 'text') notePressPaint('files', resource.path, 'text')
    else notePressPaint('files', resource.path, 'colour', { highlight: event.status })
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
    <div className={fileBodyGridClass(splitMarkdown, currentReferences !== null)}>
      <div className='relative flex min-h-0 min-w-0 flex-col overflow-hidden'>
        <Editor
          active={active && currentActions !== null}
          additionalPlugins={editorPlugins}
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
        {fileState.status === 'error' && resource ? (
          <FileLoadError
            path={resource.path}
            message={fileState.message}
            hasContent={editorDocument !== null}
          />
        ) : null}
        {!editorDocument && fileState.status !== 'error' ? (
          <div className='bg-background text-muted-foreground absolute inset-x-0 bottom-0 flex items-center gap-2 px-3 py-2 text-xs'>
            <Spinner size='xs' label='Loading file' />
            Loading file…
          </div>
        ) : null}
      </div>
      {splitMarkdown && editorDocument && resource ? (
        <MarkdownPreviewPane
          buffer={editorDocument.buffer}
          documentPath={resource.path}
          rootPath={rootPath}
          sync={scrollSync}
        />
      ) : null}
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
