import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { ToggleIconButton } from '@/components/toggle-icon-button'
import { Kbd } from '@workspace/ui/components/kbd'
import { useCommandShortcut } from '@/keymap/hooks/use-command-shortcut'
import { useNavigation } from '@/hooks/use-navigation'
import { ChatCircleIcon, SidebarSimpleIcon, SquaresFourIcon } from '@phosphor-icons/react'

import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { setChatModeSessionRailOpen } from '@/features/chat-mode/utils/panels'
import { NATIVE_WINDOW_NO_DRAG_CLASS } from '@/lib/platform/window-drag'
import { workspaceUiModeLabel } from '@/lib/ui-mode'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'

export function UiModeToggle() {
  const navigation = useNavigation()
  const uiMode = useEditorWorkspaceState((state) => state.uiMode)
  const chatModePanels = useEditorWorkspaceState((state) => state.chatModePanels)
  const railShortcut = useCommandShortcut('workspace.toggleSessionRail')

  function toggleSessionRail() {
    void navigation.setChatModePanels(
      setChatModeSessionRailOpen(chatModePanels, !chatModePanels.sessionRailOpen),
    )
  }

  return (
    <div className={cn(NATIVE_WINDOW_NO_DRAG_CLASS, 'flex shrink-0 items-center gap-1')}>
      {uiMode === 'chat' ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label='Toggle sessions'
                aria-pressed={chatModePanels.sessionRailOpen}
                className='text-muted-foreground'
                size='icon-sm'
                type='button'
                variant='ghost'
                onClick={toggleSessionRail}
              >
                <SidebarSimpleIcon className='size-(--icon-size)' />
              </Button>
            }
          />{' '}
          <TooltipContent>
            Toggle sessions
            {railShortcut ? <Kbd>{railShortcut}</Kbd> : null}
          </TooltipContent>
        </Tooltip>
      ) : null}
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
