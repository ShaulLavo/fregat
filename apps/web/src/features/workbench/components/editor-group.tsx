import type { GitFileStatus } from '@workspace/contracts'
import { FileDashedIcon } from '@phosphor-icons/react'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { cn } from '@workspace/ui/lib/utils'
import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { EditorBreadcrumbs } from '@/features/workbench/components/editor-breadcrumbs'
import { EditorGroupDropOverlay } from '@/features/workbench/components/editor-group-drop-overlay'
import { EditorSurfaceTabBody } from '@/features/workbench/components/editor-surface-tab-body'
import { EditorTabBar } from '@/features/workbench/components/editor-tab-bar'
import { useEditorInputPending } from '@/features/workbench/hooks/use-editor-input-pending'
import { editorTabModel } from '@/features/workspace/utils/tab-model'
import type { EditorTabConflictMap } from '@/features/workspace/utils/tab-types'
import { tabFileResource } from '@/lib/documents/utils/capabilities'
import type { EditorGroup as EditorGroupModel } from '@/lib/documents/utils/group-types'
import type { FilesystemPath } from '@/lib/documents/utils/types'

export function EditorGroup({
  active,
  conflicts,
  gitFiles,
  group,
  rootPath,
}: {
  readonly active: boolean
  readonly conflicts: EditorTabConflictMap
  readonly gitFiles: readonly GitFileStatus[]
  readonly group: EditorGroupModel
  readonly rootPath: FilesystemPath
}) {
  const commands = useEditorCommands()
  const selectedTab = group.tabs.find((tab) => tab.id === group.selectedTabId) ?? null
  const inputPending = useEditorInputPending(selectedTab?.content)
  const filePath = selectedTab ? tabFileResource(selectedTab.content)?.path : null
  const tabs = group.tabs.map((tab) =>
    editorTabModel({ conflicts, gitFiles, rootPath, selectedTabId: group.selectedTabId, tab }),
  )

  function activate() {
    if (!active) void commands.setActiveGroup(group.id)
  }

  return (
    <section
      className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden'
      data-editor-group-id={group.id}
      data-editor-group-active={active || undefined}
      onPointerDownCapture={activate}
      onFocusCapture={activate}
    >
      <EditorTabBar
        groupId={group.id}
        loadingTabId={inputPending ? selectedTab?.id : null}
        tabs={tabs}
      />
      <div
        className={cn(
          'relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
          // The panel already paints one layer; text gets the lift on top of it.
          selectedTab && 'bg-content-well',
        )}
        data-editor-group-content=''
      >
        {filePath && selectedTab ? (
          <EditorBreadcrumbs
            key={filePath}
            filePath={filePath}
            rootPath={rootPath}
            tabId={selectedTab.id}
          />
        ) : null}
        {selectedTab ? (
          <div className='min-h-0 min-w-0 flex-1 overflow-hidden'>
            <RenderErrorBoundary label='This tab' resetKeys={[selectedTab.id]}>
              <EditorSurfaceTabBody
                active={active}
                content={selectedTab.content}
                rootPath={rootPath}
                tabId={selectedTab.id}
              />
            </RenderErrorBoundary>
          </div>
        ) : (
          <EmptyState
            className='h-full'
            hint='Open a file to start editing.'
            icon={<FileDashedIcon className='size-(--icon-size)' />}
            title='No file selected'
          />
        )}
        <EditorGroupDropOverlay groupId={group.id} />
      </div>
    </section>
  )
}
