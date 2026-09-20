import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import type { SessionId } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { ChatCircleIcon, ClockCounterClockwiseIcon, PlusIcon } from '@phosphor-icons/react'

import { chatSessionPreview, formatChatDateLabel } from '@/features/chat/utils/formatters'
import { ToolPaneHeader } from '@/components/tool-pane-header'
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
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label='New chat'
                  className='text-muted-foreground'
                  disabled={disabled || creating}
                  size='icon-sm'
                  type='button'
                  variant='ghost'
                  onClick={onNewChat}
                >
                  <span className='relative flex size-4 items-center justify-center'>
                    <ChatCircleIcon className='size-(--icon-size)' />
                    <PlusIcon
                      className='absolute -right-0.5 -bottom-0.5 size-(--icon-size-sm)'
                      weight='bold'
                    />
                  </span>
                </Button>
              }
            />
            <TooltipContent>New chat</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuTrigger
                    render={
                      <Button
                        aria-label='Conversation history'
                        className='text-muted-foreground'
                        disabled={historyDisabled}
                        size='icon-sm'
                        type='button'
                        variant='ghost'
                      />
                    }
                  />
                }
              >
                <ClockCounterClockwiseIcon className='size-(--icon-size)' />
              </TooltipTrigger>
              <TooltipContent>Conversation history</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align='end' className='w-72 p-1'>
              {sessions.map((session) => (
                <DropdownMenuItem
                  className='grid grid-cols-[1fr_auto] gap-y-0.5'
                  data-selected={session.id === activeSessionId || undefined}
                  key={session.id}
                  title={`${session.title} — ${chatSessionPreview(session)}`}
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
