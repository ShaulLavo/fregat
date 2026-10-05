import type { DiffAttachment } from '@/lib/diff-attachment'
import type {
  DiffPanePublicationSink,
  TabPresentation,
} from '@/features/editor/state/tab-presentation'
import type { TabId } from '@/lib/documents/utils/types'
import type { DiffRegionStore } from '@singapore-editor/diff'
import {
  type GroupImperativeHandle,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@workspace/ui/components/resizable'
import { use, useLayoutEffect, useRef } from 'react'
import { EditorDocumentStateContext } from '@/features/editor/state/document-state'
import { useTabPresentation } from '@/features/editor/hooks/use-tab-presentation'
import { LoadingState } from '@workspace/ui/components/loading-state'

import { DiffPane } from '@/features/editor/components/diff-pane'
import { useDiffPanes } from '@/features/editor/hooks/use-diff-panes'
import { useEditorColorTheme } from '@/lib/editor-theme/hooks/use-editor-color-theme'
import { editorDiffSyntax, editorSyntaxColors } from '@/features/editor/state/syntax-highlighting'
import type { DiffLanguageServerContext } from '@/features/editor/utils/diff-language-context'
import type { EditorDiffViewMode } from '@/features/editor/utils/diff-view-mode'

/**
 * A diff, drawn as one or two real `Editor`s with the diff plugin supplying the rows.
 *
 * `editor-diff-view` on the root is not decoration: the package declares its `--editor-diff-*`
 * block there, and a context row carries no row class of its own, so it inherits from here.
 */
export function DiffEditor({
  attachment,
  failure,
  languageServer = null,
  mode,
  regions,
  presentation: suppliedPresentation,
  tabId,
  onPublication,
}: {
  attachment: DiffAttachment | null
  failure?: string | null
  languageServer?: DiffLanguageServerContext | null
  mode: EditorDiffViewMode
  presentation?: TabPresentation
  regions?: DiffRegionStore
  tabId?: TabId
  onPublication?: DiffPanePublicationSink
}) {
  const documentStore = use(EditorDocumentStateContext)
  const operation = attachment?.kind === 'operation' ? attachment.read.input : null
  useLayoutEffect(() => {
    if (!operation || !documentStore) return
    const lease = documentStore.getState().acquireSnapshotComparison({
      input: operation,
      signal: new AbortController().signal,
    })
    return () => lease.release()
  }, [documentStore, operation])
  const file = attachment?.file ?? null
  const { editorTheme, shikiTheme } = useEditorColorTheme()
  const colors = editorSyntaxColors(shikiTheme)
  // Stable backend identity preserves diff sessions when only their colors change.
  const syntax = editorDiffSyntax(colors)
  // Split is two plugin instances, and a separator row is one region shown twice. Without a shared
  // store a gutter click would expand one pane and leave the other where it was, misaligning every
  // row below — the one property split mode exists to hold.
  const tabPresentation = useTabPresentation(tabId)
  const presentation = suppliedPresentation ?? tabPresentation
  const regionStore = regions ?? presentation.regions
  const panes = useDiffPanes()
  const layout = presentation.diffLayout
  const groupRef = useRef<GroupImperativeHandle | null>(null)
  const split = file !== null && mode === 'split'
  useLayoutEffect(() => {
    if (!split) return
    // The held comparison supplies its presentation; restore its split in the same paint.
    groupRef.current?.setLayout(layout ?? { 'diff-old': 50, 'diff-new': 50 })
  }, [layout, presentation, split])
  useLayoutEffect(() => {
    if (file) presentation.setDiffFile(file)
  }, [file, presentation])

  if (failure && !file) return null

  if (!file || !attachment)
    return (
      <LoadingState className='flex h-full flex-col gap-3 p-4' label='Loading comparison'>
        <div className='skeleton-sweep h-4 w-3/4 rounded-md' />
        <div className='skeleton-sweep h-4 w-1/2 rounded-md' />
      </LoadingState>
    )

  if (mode === 'stacked') {
    return (
      <div className='editor-diff-view flex h-full min-h-0 w-full min-w-0 overflow-hidden'>
        <DiffPane
          attachment={attachment}
          languageServer={languageServer}
          regions={regionStore}
          presentation={presentation.diffPanes.stacked}
          side='stacked'
          syntaxBackend={syntax.backend}
          syntaxHighlight={syntax.theme !== null}
          syntaxTheme={syntax.theme}
          tabId={tabId}
          theme={editorTheme}
          onPublication={onPublication}
        />
      </div>
    )
  }

  const splitPane = {
    attachment,
    languageServer,
    regions: regionStore,
    syntaxBackend: syntax.backend,
    syntaxHighlight: syntax.theme !== null,
    syntaxTheme: syntax.theme,
    tabId,
    theme: editorTheme,
    onFocus: panes.handleFocus,
    onRegisterEditor: panes.registerEditor,
    onPublication,
    onScroll: panes.handleScroll,
  }

  return (
    <div className='editor-diff-view flex h-full min-h-0 w-full min-w-0 overflow-hidden'>
      <ResizablePanelGroup
        className='min-h-0 min-w-0'
        defaultLayout={layout}
        groupRef={groupRef}
        id={`diff-panes-${tabId ?? 'standalone'}`}
        onLayoutChanged={(layout, meta) => {
          if (meta.isUserInteraction) presentation.setDiffLayout(layout)
        }}
      >
        <ResizablePanel className='min-h-0 min-w-0 overflow-hidden' id='diff-old'>
          <DiffPane {...splitPane} presentation={presentation.diffPanes.old} side='old' />
        </ResizablePanel>
        <ResizableHandle id='diff-panes-handle' withHandle />
        <ResizablePanel className='min-h-0 min-w-0 overflow-hidden' id='diff-new'>
          <DiffPane {...splitPane} presentation={presentation.diffPanes.new} side='new' />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
