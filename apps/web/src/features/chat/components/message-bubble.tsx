import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import type { OrchestrationMessage } from '@workspace/contracts'
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
import type { MouseEvent, ReactNode } from 'react'

import { useContextMenu } from '@/keymap/menus/hooks/use-context-menu'

import { formatChatTimestamp } from '@/features/chat/utils/formatters'
import { resolveAssistantMessageChromeState } from '@/features/chat/utils/message-metadata'
import { extractTerminalContexts } from '@workspace/client-core/chat/terminal-context'
import type { OptimisticChatMessage } from '../state/chat-message-intents'
import type { ChatTurnDiffSummary } from '@workspace/client-core/chat/types'
import { allowsMessageContextMenu } from '../utils/message-menu'
import { useChatTimelineActions } from '../hooks/use-chat-timeline-actions'
import { AssistantChangedFilesSection } from './assistant-changed-files-section'
import { ChatAttachmentThumbnails } from './chat-attachment-thumbnails'
import { AssistantMessageMeta } from './assistant-message-meta'
import { AssistantMarkdown } from './assistant-markdown'
import { MessageCompletionDivider } from './message-completion-divider'
import { MessageMenu } from './message-menu'
import { TerminalContextChip } from './terminal-context-chip'
import { UserMessageBody } from './user-message-body'

export function MessageBubble({
  assistantStreaming,
  assistantTurnInProgress = false,
  checkpointRevertPending = false,
  completionSummary = null,
  durationEnd,
  durationStart,
  message,
  renderAssistantCopyButton,
  revertTurnCount = null,
  showAssistantCopyButton = false,
  showCompletionDivider = false,
  turnDiffSummary = null,
}: {
  assistantStreaming?: boolean
  assistantTurnInProgress?: boolean
  checkpointRevertPending?: boolean
  completionSummary?: string | null
  durationEnd?: string
  durationStart?: string
  message: OrchestrationMessage | OptimisticChatMessage
  renderAssistantCopyButton?: (text: string) => ReactNode
  revertTurnCount?: number | null
  showAssistantCopyButton?: boolean
  showCompletionDivider?: boolean
  turnDiffSummary?: ChatTurnDiffSummary | null
}) {
  const { revertToCheckpoint } = useChatTimelineActions()
  const contextMenu = useContextMenu()
  const user = message.role === 'user'
  const assistant = message.role === 'assistant'
  const effectiveAssistantStreaming = assistantStreaming ?? (assistant ? message.streaming : false)
  const optimistic = 'optimistic' in message
  const attachments = message.attachments ?? []
  const assistantText = assistant
    ? message.text ||
      (effectiveAssistantStreaming || assistantTurnInProgress ? '' : 'No response text')
    : ''
  // The composer appends captured terminal output as an XML block after the
  // prompt. Split it back off so the reader sees the words they typed plus the
  // same chip the composer showed, never the markup the agent received.
  const userMessage = user
    ? extractTerminalContexts(message.text)
    : { contexts: [], text: message.text }
  const attachmentList = (
    <ChatAttachmentThumbnails
      attachments={attachments}
      className={cn(user && userMessage.text.trim().length > 0 && 'mb-2', !user && 'mt-2')}
    />
  )
  const assistantChrome = resolveAssistantMessageChromeState({
    showCopyButton: showAssistantCopyButton,
    streaming: effectiveAssistantStreaming || assistantTurnInProgress,
    text: message.text,
  })
  const canRevertCheckpoint = user && typeof revertTurnCount === 'number'

  function handleRevertClick() {
    if (typeof revertTurnCount !== 'number') return

    revertToCheckpoint(revertTurnCount, message.id)
  }

  // Opened by hand rather than through MenuSurface's trigger: the trigger
  // applies `select-none`, which would make message text unselectable.
  function handleContextMenu(event: MouseEvent<HTMLElement>) {
    if (!allowsMessageContextMenu(event.target)) return

    contextMenu.openAtEvent(event, event.currentTarget)
  }

  return (
    <>
      {assistant && showCompletionDivider ? (
        <MessageCompletionDivider completionSummary={completionSummary} />
      ) : null}
      <div
        className={cn(
          'group/message flex w-full min-w-0',
          user ? 'justify-end' : 'justify-start',
          optimistic && 'text-muted-foreground text-2xs',
        )}
      >
        <article
          className={cn(
            'min-w-0 text-sm leading-5',
            user
              ? 'max-w-[80%] rounded-lg bg-muted px-4 py-3 text-foreground'
              : 'w-full max-w-full px-1 py-0.5 text-foreground',
          )}
          onContextMenu={handleContextMenu}
        >
          {user ? (
            <>
              {attachmentList}
              {userMessage.text.trim().length > 0 ? (
                <UserMessageBody text={userMessage.text} />
              ) : null}
              {userMessage.contexts.length > 0 ? (
                <div
                  className={cn(
                    'flex min-w-0 flex-wrap gap-1',
                    userMessage.text.trim().length > 0 && 'mt-2',
                  )}
                >
                  {userMessage.contexts.map((context) => (
                    <TerminalContextChip
                      key={`${context.source}:${context.lineStart}-${context.lineEnd}`}
                      selection={context}
                    />
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <AssistantMarkdown text={assistantText} streaming={effectiveAssistantStreaming} />
              {turnDiffSummary ? <AssistantChangedFilesSection summary={turnDiffSummary} /> : null}
              {attachmentList}
            </>
          )}
          {user ? (
            <div
              className='text-muted-foreground text-3xs mt-1 flex items-center justify-end gap-1.5 tabular-nums transition-opacity group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 group-hover/message:pointer-events-auto group-hover/message:opacity-100 [@media(hover:hover)]:pointer-events-none [@media(hover:hover)]:opacity-0'
              data-user-message-meta='true'
            >
              <span className='size-5 shrink-0'>
                {canRevertCheckpoint ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          aria-label='Revert to checkpoint before this turn'
                          className='size-5'
                          data-scroll-anchor-ignore
                          disabled={checkpointRevertPending}
                          focusableWhenDisabled
                          size='icon-sm'
                          type='button'
                          variant='ghost'
                          onClick={handleRevertClick}
                        >
                          <ArrowCounterClockwiseIcon
                            aria-hidden='true'
                            className='size-(--icon-size-sm)'
                          />
                        </Button>
                      }
                    />{' '}
                    <TooltipContent>{'Revert to checkpoint before this turn'}</TooltipContent>
                  </Tooltip>
                ) : null}
              </span>
              <span>{messageTimestampLabel(message, optimistic)}</span>
            </div>
          ) : null}
          {!user && assistantChrome.metaVisible ? (
            <div
              className='mt-1.5 flex items-center gap-2 transition-opacity group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 group-hover/message:pointer-events-auto group-hover/message:opacity-100 [@media(hover:hover)]:pointer-events-none [@media(hover:hover)]:opacity-0'
              data-assistant-message-meta='true'
            >
              <p className='text-muted-foreground text-3xs tabular-nums'>
                <AssistantMessageMeta
                  createdAt={message.createdAt}
                  durationEnd={durationEnd ?? message.updatedAt}
                  durationStart={durationStart ?? message.createdAt}
                  streaming={effectiveAssistantStreaming}
                />
              </p>
              {assistantChrome.copyVisible && renderAssistantCopyButton ? (
                <div className='flex items-center' data-assistant-copy-actions='true'>
                  {renderAssistantCopyButton(assistantChrome.copyText ?? '')}
                </div>
              ) : null}
            </div>
          ) : null}
        </article>
        {contextMenu.open ? (
          <MessageMenu
            anchor={contextMenu.anchor}
            checkpointRevertPending={checkpointRevertPending}
            message={message}
            onOpenChange={contextMenu.onOpenChange}
            revertTurnCount={revertTurnCount}
            turnDiffSummary={turnDiffSummary}
          />
        ) : null}
      </div>
    </>
  )
}

function messageTimestampLabel(
  message: OrchestrationMessage | OptimisticChatMessage,
  optimistic: boolean,
) {
  if (optimistic) return 'Sending'
  if (message.streaming) return 'Streaming'

  return formatChatTimestamp(message.updatedAt)
}
