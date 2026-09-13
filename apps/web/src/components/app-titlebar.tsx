import { UiModeToggle } from '@/components/ui-mode-toggle'
import { WorkspaceProjectMenu } from '@/components/workspace-project-menu'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { TitlebarMenu } from '@/features/workbench/components/titlebar-menu'
import { titlebarModel } from '@/features/workbench/utils/titlebar-model'
import { isMacDesktop } from '@/lib/platform/bridge'
import { NATIVE_WINDOW_DRAG_CLASS } from '@/lib/platform/window-drag'
import { cn } from '@workspace/ui/lib/utils'

export function AppTitlebar() {
  const rootFolder = useEditorWorkspaceState((state) => state.rootFolder)
  const layout = useEditorWorkspaceState((state) => state.workbenchLayout)
  const uiMode = useEditorWorkspaceState((state) => state.uiMode)
  const model = titlebarModel(rootFolder, layout, uiMode)

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
          isMacDesktop() && 'pl-[4.75rem]',
        )}
      >
        <WorkspaceProjectMenu workspaceTitle={model.workspaceTitle} />
      </div>
      {model.gridTemplateColumns.includes('%') ? <div aria-hidden='true' /> : null}
      <div className='flex items-center px-(--bar-padding-x)'>
        <UiModeToggle />
      </div>
    </header>
  )

  return <TitlebarMenu trigger={titlebar} />
}
