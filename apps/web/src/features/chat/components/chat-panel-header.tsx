import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import type { SessionId } from '@workspace/contracts'
import type { SessionRailItem } from '@workspace/client-core/chat/rail/model'
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
import { SessionActionsButton } from '@/components/session-actions-button'
import { BackgroundTasksButton } from '@/features/chat/components/background-tasks-button'
import { SessionRename } from '@/components/session-rename'
import { useSessionRenaming } from '@/hooks/use-session-renaming'
import type { ChatSessionListProjection } from '@workspace/client-core/chat/selectors'

export function ChatPanelHeader({
  activeSessionId,
  creating,
  disabled,
  onNewChat,
  onSelectSession,
  session,
  sessions,
}: {
  activeSessionId: SessionId | null
  /** The open conversation; null on a draft, which has no session to act on. */
  session: SessionRailItem | null
  creating: boolean
  disabled: boolean
  onNewChat: () => void
  onSelectSession: (sessionId: SessionId) => void
  sessions: readonly ChatSessionListProjection[]
}) {
  const historyDisabled = sessions.length === 0
  const activeSession = sessions.find((candidate) => candidate.id === activeSessionId)
  const editing = useSessionRenaming(session, 'sidebar')

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
                  focusableWhenDisabled
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
                        focusableWhenDisabled
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
              {sessions.map((item) => (
                <DropdownMenuItem
                  className='grid grid-cols-[1fr_auto] gap-y-0.5'
                  data-selected={item.id === activeSessionId || undefined}
                  key={item.id}
                  title={`${item.title} — ${chatSessionPreview(item)}`}
                  onClick={() => onSelectSession(item.id)}
                >
                  <span className='truncate font-medium'>
                    {item.id === activeSessionId ? 'Current: ' : ''}
                    {item.title}
                  </span>
                  <span className='text-muted-foreground text-2xs tabular-nums'>
                    {formatChatDateLabel(item.activityAt)}
                  </span>
                  <span className='text-muted-foreground text-2xs col-span-2 truncate tabular-nums'>
                    {chatSessionPreview(item)}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {session ? <BackgroundTasksButton sessionRef={session.ref} /> : null}
          {session ? <SessionActionsButton session={session} surface='sidebar' /> : null}
        </>
      }
      detail={
        editing && session ? (
          <SessionRename
            className='text-foreground h-(--density-control-height-sm) min-w-0 flex-1 px-(--density-row-padding-x) text-xs font-medium'
            session={session}
          />
        ) : (
          activeSession?.title
        )
      }
      tab='chat'
    />
  )
}
