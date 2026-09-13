import type { SessionId } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { ChatCircleIcon, ClockCounterClockwiseIcon, PlusIcon } from '@phosphor-icons/react'

import { chatSessionPreview, formatChatDateLabel } from '@/features/chat/utils/formatters'
import { ToolPaneHeader } from '@/features/workbench/components/tool-pane-header'
import type { ChatSessionListProjection } from '@workspace/client-core/chat/selectors'

export function ChatPanelHeader({
  activeSessionId,
  creating,
  disabled,
  onNewChat,
  onSelectSession,
  sessions,
}: {
  activeSessionId: SessionId | null
  creating: boolean
  disabled: boolean
  onNewChat: () => void
  onSelectSession: (sessionId: SessionId) => void
  sessions: readonly ChatSessionListProjection[]
}) {
  const historyDisabled = sessions.length === 0
  const activeSession = sessions.find((session) => session.id === activeSessionId)

  return (
    <ToolPaneHeader
      actions={
        <>
          <Button
            aria-label='New chat'
            className='text-muted-foreground'
            disabled={disabled || creating}
            size='icon-sm'
            title='New chat'
            type='button'
            variant='ghost'
            onClick={onNewChat}
          >
            <span className='relative flex size-4 items-center justify-center'>
              <ChatCircleIcon className='size-4' />
              <PlusIcon className='absolute -right-0.5 -bottom-0.5 size-2.5' weight='bold' />
            </span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label='Conversation history'
                  className='text-muted-foreground'
                  disabled={historyDisabled}
                  size='icon-sm'
                  title='Conversation history'
                  type='button'
                  variant='ghost'
                />
              }
            >
              <ClockCounterClockwiseIcon className='size-4' />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-72 p-1'>
              {sessions.map((session) => (
                <DropdownMenuItem
                  className={cn(
                    'grid grid-cols-[1fr_auto] gap-y-0.5',
                    session.id === activeSessionId && 'bg-row-selected',
                  )}
                  key={session.id}
                  onClick={() => onSelectSession(session.id)}
                >
                  <span className='truncate font-medium'>
                    {session.id === activeSessionId ? 'Current: ' : ''}
                    {session.title}
                  </span>
                  <span className='text-muted-foreground text-2xs tabular-nums'>
                    {formatChatDateLabel(session.activityAt)}
                  </span>
                  <span className='text-muted-foreground text-2xs col-span-2 truncate tabular-nums'>
                    {chatSessionPreview(session)}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
      detail={activeSession?.title}
      tab='chat'
    />
  )
}
