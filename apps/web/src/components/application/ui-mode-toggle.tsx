import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { ToggleIconButton } from '@/components/toggle-icon-button'
import { Kbd } from '@workspace/ui/components/kbd'
import { useCommandShortcut } from '@/keymap/hooks/use-command-shortcut'
import { useNavigation } from '@/hooks/use-navigation'
import { ChatCircleIcon, SidebarSimpleIcon, SquaresFourIcon } from '@phosphor-icons/react'

import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { useCommandBus } from '@/keymap/hooks/use-command-bus'
import { NATIVE_WINDOW_NO_DRAG_CLASS } from '@/lib/platform/window-drag'
import { workspaceUiModeLabel } from '@/lib/ui-mode'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'

export function UiModeToggle() {
  const navigation = useNavigation()
  const bus = useCommandBus()
  const uiMode = useEditorWorkspaceState((state) => state.uiMode)
  const sidebarOpen = useEditorWorkspaceState((state) =>
    state.uiMode === 'chat'
      ? state.chatModePanels.sessionRailOpen
      : state.workbenchPanels.sidebarOpen,
  )
  const label = uiMode === 'chat' ? 'Toggle sessions' : 'Toggle sidebar'
  const sidebarShortcut = useCommandShortcut('workspace.toggleSidebarVisibility')

  function toggleSidebar() {
    bus.dispatch('workspace.toggleSidebarVisibility', {
      source: { kind: 'programmatic', caller: 'titlebar' },
    })
  }

  return (
    <div className={cn(NATIVE_WINDOW_NO_DRAG_CLASS, 'flex shrink-0 items-center gap-1')}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={label}
              aria-pressed={sidebarOpen}
              className='text-muted-foreground'
              size='icon-sm'
              type='button'
              variant='ghost'
              onClick={toggleSidebar}
            >
              <SidebarSimpleIcon className='size-(--icon-size)' />
            </Button>
          }
        />
        <TooltipContent>
          {label}
          {sidebarShortcut ? <Kbd>{sidebarShortcut}</Kbd> : null}
        </TooltipContent>
      </Tooltip>
      <div className='flex items-center gap-(--density-gap-tight)'>
        <ToggleIconButton
          active={uiMode === 'workbench'}
          command='workspace.showWorkbenchMode'
          icon={<SquaresFourIcon className='size-(--icon-size-sm)' />}
          label={`${workspaceUiModeLabel('workbench')} mode`}
          onClick={() => void navigation.setMode('workbench')}
        />
        <ToggleIconButton
          active={uiMode === 'chat'}
          command='workspace.showChatMode'
          icon={<ChatCircleIcon className='size-(--icon-size-sm)' />}
          label={`${workspaceUiModeLabel('chat')} mode`}
          onClick={() => void navigation.setMode('chat')}
        />
      </div>
    </div>
  )
}
