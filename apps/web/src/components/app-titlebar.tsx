import { FileIcon } from '@phosphor-icons/react'

import { UiModeToggle } from '@/components/ui-mode-toggle'
import { WorkspaceProjectMenu } from '@/components/workspace-project-menu'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { TitlebarMenu } from '@/features/workbench/components/titlebar-menu'
import { titlebarModel } from '@/features/workbench/utils/titlebar-model'
import { isDesktop } from '@/lib/platform/bridge'
import { NATIVE_WINDOW_DRAG_CLASS } from '@/lib/platform/window-drag'
import { cn } from '@workspace/ui/lib/utils'

export function AppTitlebar() {
  const rootFolder = useEditorWorkspaceState((state) => state.rootFolder)
  const panels = useEditorWorkspaceState((state) => state.workbenchPanels)
  const layout = useEditorWorkspaceState((state) => state.workbenchLayout)
  const uiMode = useEditorWorkspaceState((state) => state.uiMode)
  const model = titlebarModel(rootFolder, panels, layout, uiMode)

  // Built as an element rather than returned so the whole bar — including the
  // gaps between its controls — is the context menu's trigger.
  const titlebar = (
    <header
      aria-label='Window toolbar'
      className={cn(
        NATIVE_WINDOW_DRAG_CLASS,
        'bg-card backdrop-material border-border grid h-(--bar-height) shrink-0 select-none border-b',
      )}
      data-native-window-drag-region=''
      style={{ gridTemplateColumns: model.gridTemplateColumns }}
    >
      <div
        className={cn(
          'flex min-w-0 items-center px-(--bar-padding-x)',
          isDesktop() && 'pl-[4.75rem]',
        )}
      >
        <WorkspaceProjectMenu workspaceTitle={model.workspaceTitle} />
      </div>
      {model.documentTitle ? (
        <div className='border-subtle flex min-w-0 items-center gap-(--density-control-gap) border-l px-(--bar-padding-x)'>
          <FileIcon className='text-muted-foreground size-4 shrink-0' />
          <span className='truncate text-xs font-medium'>{model.documentTitle}</span>
          <div aria-hidden='true' className='min-w-16 flex-1 self-stretch' />
        </div>
      ) : null}
      <div className='flex items-center px-(--bar-padding-x)'>
        <UiModeToggle />
      </div>
    </header>
  )

  return <TitlebarMenu trigger={titlebar} />
}
