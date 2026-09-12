import type { TabId } from '@/lib/documents/utils/types'
import { createDiffRegionStore, type DiffFile, type DiffRegionStore } from '@singapor/diff'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@workspace/ui/components/resizable'
import { useMemo, useState } from 'react'

import { DiffPane } from '@/features/editor/components/diff-pane'
import { useDiffPanes } from '@/features/editor/hooks/use-diff-panes'
import { useEditorColorTheme } from '@/features/editor/hooks/use-editor-color-theme'
import { editorDiffSyntaxConfiguration } from '@/features/editor/state/syntax-highlighting'
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
  languageServer = null,
  mode,
  regions,
  tabId,
}: {
  file: DiffFile | null
  languageServer?: DiffLanguageServerContext | null
  mode: EditorDiffViewMode
  regions?: DiffRegionStore
  tabId?: TabId
}) {
  const { editorTheme, registration, shikiTheme } = useEditorColorTheme()
  // Theme selection and its async Shiki registration landing both require new per-file sessions.
  const syntax = useMemo(
    () => editorDiffSyntaxConfiguration(shikiTheme, registration?.name ?? null),
    [registration, shikiTheme],
  )
  // Split is two plugin instances, and a separator row is one region shown twice. Without a shared
  // store a gutter click would expand one pane and leave the other where it was, misaligning every
  // row below — the one property split mode exists to hold.
  const [privateRegions] = useState(createDiffRegionStore)
  const regionStore = regions ?? privateRegions
  const panes = useDiffPanes()

  if (mode === 'stacked') {
    return (
      <div className='editor-diff-view flex h-full min-h-0 w-full min-w-0 overflow-hidden'>
        <DiffPane
          file={file}
          languageServer={languageServer}
          regions={regionStore}
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
      <ResizablePanelGroup className='min-h-0 min-w-0' id='diff-panes'>
        <ResizablePanel className='min-h-0 min-w-0 overflow-hidden' id='diff-old'>
          <DiffPane
            file={file}
            languageServer={languageServer}
            regions={regionStore}
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
            languageServer={languageServer}
            regions={regionStore}
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
