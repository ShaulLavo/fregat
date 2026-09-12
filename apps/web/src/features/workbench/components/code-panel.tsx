import type { GitFileStatus } from '@workspace/contracts'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { FileDashedIcon } from '@phosphor-icons/react'
import { EmptyState } from '@workspace/ui/components/empty-state'

import { EMPTY_GIT_FILES, editorTabModel } from '@/features/workspace/utils/tab-model'
import { EditorSurfaceTabBody } from '@/features/workbench/components/editor-surface-tab-body'
import { EditorTabBar } from '@/features/workbench/components/editor-tab-bar'
import { useEditorInputPending } from '@/features/workbench/hooks/use-editor-input-pending'

import type { EditorTabConflictMap } from '@/features/workspace/utils/tab-types'
import type { WorkbenchPanels } from '@/features/workbench/utils/panels'

export function CodePanel({
  conflicts,

  gitFiles = EMPTY_GIT_FILES,
  panels,
  rootPath,
}: {
  readonly conflicts: EditorTabConflictMap

  readonly gitFiles?: readonly GitFileStatus[]
  readonly panels: WorkbenchPanels
  readonly rootPath: FilesystemPath
}) {
  const tabModels = panels.editorTabs.map((tab) =>
    editorTabModel({
      conflicts,
      gitFiles,
      rootPath,
      selectedTabId: panels.activeEditorTabId,
      tab,
    }),
  )
  const activeTab = panels.editorTabs.find((tab) => tab.id === panels.activeEditorTabId) ?? null
  const inputPending = useEditorInputPending(activeTab?.content)
  const loadingTabId = inputPending ? activeTab?.id : null

  return (
    <section className='bg-content-well border-border flex h-full min-h-0 min-w-0 flex-col overflow-hidden'>
      <EditorTabBar loadingTabId={loadingTabId} tabs={tabModels} />
      <div className='min-h-0 min-w-0 flex-1 overflow-hidden'>
        {activeTab ? (
          <EditorSurfaceTabBody
            active
            content={activeTab.content}
            rootPath={rootPath}
            tabId={activeTab.id}
          />
        ) : (
          <EmptyState
            className='h-full'
            hint={
              <>
                <kbd className='border-border bg-muted text-muted-foreground rounded border px-1.5 py-0.5 font-mono text-[10px]'>
                  ⌘P
                </kbd>
                Quick access
              </>
            }
            icon={<FileDashedIcon className='size-8' />}
            title='No file selected'
          />
        )}
      </div>
    </section>
  )
}
