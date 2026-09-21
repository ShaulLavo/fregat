import { useDiffPaintOwner } from '@/features/editor/hooks/use-diff-paint-owner'
import { hasSavedDiffPaint, savedDiffPaintView } from '@/features/editor/state/diff-paint'
import type { TabId } from '@/lib/documents/utils/types'
import { type DiffFile, type DiffRegionStore } from '@singapore-editor/diff'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@workspace/ui/components/resizable'
import { useLayoutEffect } from 'react'
import { useTabPresentation } from '@/features/editor/hooks/use-tab-presentation'
import { LoadingState } from '@workspace/ui/components/loading-state'

import { DiffPane } from '@/features/editor/components/diff-pane'
import { useDiffPanes } from '@/features/editor/hooks/use-diff-panes'
import { useEditorColorTheme } from '@/lib/editor-theme/hooks/use-editor-color-theme'
import {
  editorDiffSyntaxConfiguration,
  editorSyntaxHighlightingSource,
} from '@/features/editor/state/syntax-highlighting'
import type { DiffLanguageServerContext } from '@/features/editor/utils/diff-language-context'
import type { EditorDiffViewMode } from '@/features/editor/utils/diff-view-mode'

/**
 * A diff, drawn as one or two real `Editor`s with the diff plugin supplying the rows.
 *
 * `editor-diff-view` on the root is not decoration: it is where both the package's own
 * `--editor-diff-*` block and the app's override of it are declared, and a context row carries no
 * row class of its own, so inheritance from here is the only way the variables reach it.
 */
export function DiffEditor({
  file,
  paintIdentity,
  failure,
  languageServer = null,
  mode,
  regions,
  tabId,
}: {
  file: DiffFile | null
  paintIdentity?: string
  failure?: string | null
  languageServer?: DiffLanguageServerContext | null
  mode: EditorDiffViewMode
  regions?: DiffRegionStore
  tabId?: TabId
}) {
  const { editorTheme, shikiTheme } = useEditorColorTheme()
  const source = editorSyntaxHighlightingSource(shikiTheme)
  // Stable backend identity preserves diff sessions when only their colors change.
  const syntax = editorDiffSyntaxConfiguration(source)
  // Split is two plugin instances, and a separator row is one region shown twice. Without a shared
  // store a gutter click would expand one pane and leave the other where it was, misaligning every
  // row below — the one property split mode exists to hold.
  const presentation = useTabPresentation(tabId)
  const regionStore = regions ?? presentation.regions
  const panes = useDiffPanes()
  const paintOwner = useDiffPaintOwner()
  const savedPaint = hasSavedDiffPaint(paintOwner, paintIdentity, mode)
  const savedLayout = savedDiffPaintView(paintOwner, paintIdentity)?.layout
  const layout = presentation.diffLayout ?? savedLayout
  const getLayout = () => presentation.diffLayout ?? savedLayout
  useLayoutEffect(() => {
    if (file) presentation.setDiffFile(file)
  }, [file, presentation])

  if (failure && !file && !savedPaint) return null

  if (!file && !savedPaint)
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
          file={file}
          paintIdentity={paintIdentity}
          getLayout={getLayout}
          languageServer={languageServer}
          regions={regionStore}
          presentation={presentation.diffPanes.stacked}
          side='stacked'
          syntaxBackend={syntax.backend}
          syntaxHighlight={syntax.enabled}
          tabId={tabId}
          theme={editorTheme}
        />
      </div>
    )
  }

  return (
    <div className='editor-diff-view flex h-full min-h-0 w-full min-w-0 overflow-hidden'>
      <ResizablePanelGroup
        key={tabId}
        className='min-h-0 min-w-0'
        defaultLayout={layout}
        id={`diff-panes-${tabId ?? 'standalone'}`}
        onLayoutChanged={(layout, meta) => {
          if (meta.isUserInteraction) presentation.setDiffLayout(layout)
        }}
      >
        <ResizablePanel className='min-h-0 min-w-0 overflow-hidden' id='diff-old'>
          <DiffPane
            file={file}
            paintIdentity={paintIdentity}
            getLayout={getLayout}
            languageServer={languageServer}
            regions={regionStore}
            presentation={presentation.diffPanes.old}
            side='old'
            syntaxBackend={syntax.backend}
            syntaxHighlight={syntax.enabled}
            tabId={tabId}
            theme={editorTheme}
            onFocus={panes.handleFocus}
            onRegisterEditor={panes.registerEditor}
            onScroll={panes.handleScroll}
          />
        </ResizablePanel>
        <ResizableHandle id='diff-panes-handle' withHandle />
        <ResizablePanel className='min-h-0 min-w-0 overflow-hidden' id='diff-new'>
          <DiffPane
            file={file}
            paintIdentity={paintIdentity}
            getLayout={getLayout}
            languageServer={languageServer}
            regions={regionStore}
            presentation={presentation.diffPanes.new}
            side='new'
            syntaxBackend={syntax.backend}
            syntaxHighlight={syntax.enabled}
            tabId={tabId}
            theme={editorTheme}
            onFocus={panes.handleFocus}
            onRegisterEditor={panes.registerEditor}
            onScroll={panes.handleScroll}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
