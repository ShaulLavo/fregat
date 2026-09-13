import type { GitFileStatus } from '@workspace/contracts'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { FileDashedIcon } from '@phosphor-icons/react'
import { EmptyState } from '@workspace/ui/components/empty-state'

import { EMPTY_GIT_FILES, editorTabModel } from '@/features/workspace/utils/tab-model'
import { EditorBreadcrumbs } from '@/features/workbench/components/editor-breadcrumbs'
import { EditorSurfaceTabBody } from '@/features/workbench/components/editor-surface-tab-body'
import { EditorTabBar } from '@/features/workbench/components/editor-tab-bar'
import { useEditorInputPending } from '@/features/workbench/hooks/use-editor-input-pending'
import { tabFileResource } from '@/lib/documents/utils/capabilities'

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
  const activeFilePath = activeTab ? (tabFileResource(activeTab.content)?.path ?? null) : null

  return (
    <section className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden'>
      <EditorTabBar loadingTabId={loadingTabId} tabs={tabModels} />
      <div className='bg-content-well flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'>
        {activeFilePath ? (
          <EditorBreadcrumbs filePath={activeFilePath} rootPath={rootPath} />
        ) : null}
        {activeTab ? (
          <div className='min-h-0 min-w-0 flex-1 overflow-hidden'>
            <EditorSurfaceTabBody
              active
              content={activeTab.content}
              rootPath={rootPath}
              tabId={activeTab.id}
            />
          </div>
        ) : (
          <EmptyState
            className='h-full'
            hint={
              <>
                <kbd className='border-border bg-muted text-muted-foreground text-3xs rounded-md border px-1.5 py-0.5 font-mono'>
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
