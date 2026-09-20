import { ToggleIconButton } from '@/components/toggle-icon-button'
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

  function toggleSessionRail() {
    void navigation.setChatModePanels(
      setChatModeSessionRailOpen(chatModePanels, !chatModePanels.sessionRailOpen),
    )
  }

  return (
    <div className={cn(NATIVE_WINDOW_NO_DRAG_CLASS, 'flex shrink-0 items-center gap-1')}>
      {uiMode === 'chat' ? (
        <Button
          aria-label='Toggle sessions'
          aria-pressed={chatModePanels.sessionRailOpen}
          className='text-muted-foreground'
          size='icon-sm'
          title='Toggle sessions'
          type='button'
          variant='ghost'
          onClick={toggleSessionRail}
        >
          <SidebarSimpleIcon className='size-4' />
        </Button>
      ) : null}
      <div className='flex items-center gap-(--density-gap-tight)'>
        <ToggleIconButton
          active={uiMode === 'workbench'}
          icon={<SquaresFourIcon className='size-3.5' />}
          label={`${workspaceUiModeLabel('workbench')} mode`}
          onClick={() => void navigation.setMode('workbench')}
        />
        <ToggleIconButton
          active={uiMode === 'chat'}
          icon={<ChatCircleIcon className='size-3.5' />}
          label={`${workspaceUiModeLabel('chat')} mode`}
          onClick={() => void navigation.setMode('chat')}
        />
      </div>
    </div>
  )
}
