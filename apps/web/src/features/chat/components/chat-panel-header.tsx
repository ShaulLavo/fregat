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
    <header className='border-border/70 compact:h-10 compact:px-2 flex h-12 shrink-0 items-center justify-between border-b px-3'>
      <div className='compact:pr-2 min-w-0 pr-3'>
        <div className='truncate text-sm font-semibold'>Chat</div>
        {activeSession ? (
          <div className='text-muted-foreground truncate text-[11px]'>{activeSession.title}</div>
        ) : null}
      </div>
      <div className='flex items-center gap-1'>
        <Button
          aria-label='New chat'
          className='rounded-md'
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
                className='rounded-md'
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
          <DropdownMenuContent align='end' className='w-72 rounded-md p-1'>
            {sessions.map((session) => (
              <DropdownMenuItem
                className={cn(
                  'compact:gap-x-2 compact:px-2 compact:py-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 rounded-md px-2.5 py-2.5',
                  session.id === activeSessionId && 'bg-muted/70',
                )}
                key={session.id}
                onClick={() => onSelectSession(session.id)}
              >
                <span className='truncate font-medium'>
                  {session.id === activeSessionId ? 'Current: ' : ''}
                  {session.title}
                </span>
                <span className='text-muted-foreground text-[11px] tabular-nums'>
                  {formatChatDateLabel(session.activityAt)}
                </span>
                <span className='text-muted-foreground col-span-2 truncate text-[11px] tabular-nums'>
                  {chatSessionPreview(session)}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
