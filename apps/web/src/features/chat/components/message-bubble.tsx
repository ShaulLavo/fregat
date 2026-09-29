import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import type { OrchestrationMessage } from '@workspace/contracts'
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
import { Shimmer } from '@workspace/ui/components/shimmer'
import { StatusDot } from '@workspace/ui/components/status-dot'
import type { CheckpointRestoreRole } from '@/features/chat/utils/checkpoint-restore'
import { useState, type MouseEvent, type ReactNode } from 'react'

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
import { SentReviewComments } from './sent-review-comments'
import { ReplyQuoteBar } from './reply-quote-bar'
import { planSelectionLines, type PlanSelectionLines } from '@/features/chat/utils/plan-comment'
import { extractReviewComments } from '@workspace/client-core/chat/review-comments'
import { UserMessageBody } from './user-message-body'

export function MessageBubble({
  assistantStreaming,
  assistantTurnInProgress = false,
  checkpointRevertPending = false,
  completionSummary = null,
  durationEnd,
  durationStart,
  incomplete = false,
  message,
  renderAssistantCopyButton,
  restoreRole,
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
  incomplete?: boolean
  message: OrchestrationMessage | OptimisticChatMessage
  renderAssistantCopyButton?: (text: string) => ReactNode
  restoreRole?: CheckpointRestoreRole
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
  const terminalSplit = user
    ? extractTerminalContexts(message.text)
    : { contexts: [], text: message.text }
  // Review comments ride in front of the typed text; they come back as chips that lead home.
  const reviewSplit = user
    ? extractReviewComments(terminalSplit.text)
    : { comments: [], text: terminalSplit.text }
  const userMessage = { contexts: terminalSplit.contexts, text: reviewSplit.text }
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
  // While one turn restores, every other revert action is absent rather than disabled.
  const canRevertCheckpoint =
    user && typeof revertTurnCount === 'number' && restoreRole === undefined
  const restoring = restoreRole === 'target'
  const [quoteLines, setQuoteLines] = useState<PlanSelectionLines | null>(null)
  const quotable = assistant && !effectiveAssistantStreaming && !optimistic && message.text !== ''
  const assistantMarkdown = (
    <div
      onKeyUp={(event) => {
        if (quotable) setQuoteLines(planSelectionLines(event.currentTarget))
      }}
      onMouseUp={(event) => {
        if (quotable) setQuoteLines(planSelectionLines(event.currentTarget))
      }}
    >
      <AssistantMarkdown text={assistantText} streaming={effectiveAssistantStreaming} />
    </div>
  )

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
              <SentReviewComments comments={reviewSplit.comments} sessionId={message.sessionId} />
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
              {incomplete ? (
                <div aria-label='Incomplete answer' className='fade-out-bottom' role='group'>
                  {assistantMarkdown}
                </div>
              ) : (
                assistantMarkdown
              )}
              {quotable && quoteLines ? (
                <ReplyQuoteBar
                  message={message}
                  onDone={() => setQuoteLines(null)}
                  selection={quoteLines}
                />
              ) : null}
              {turnDiffSummary ? <AssistantChangedFilesSection summary={turnDiffSummary} /> : null}
              {attachmentList}
            </>
          )}
          {user ? (
            <div
              className={cn(
                'text-muted-foreground text-3xs mt-1 flex items-center justify-end gap-1.5 tabular-nums transition-opacity',
                restoring
                  ? 'opacity-100'
                  : 'pointer-events-none opacity-0 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 group-hover/message:pointer-events-auto group-hover/message:opacity-100 touch:pointer-events-auto touch:opacity-100',
              )}
              data-user-message-meta='true'
            >
              {restoring ? (
                <span className='flex items-center gap-1.5' role='status'>
                  <StatusDot live tone='info' />
                  <Shimmer>Rewinding…</Shimmer>
                </span>
              ) : null}
              <span className='touch:translate-x-0 size-5 shrink-0 -translate-x-2 transition-transform group-focus-within/message:translate-x-0 group-hover/message:translate-x-0'>
                {canRevertCheckpoint ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          aria-label='Rewind to before this message'
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
                    <TooltipContent>{'Rewind to before this message'}</TooltipContent>
                  </Tooltip>
                ) : null}
              </span>
              <span>{messageTimestampLabel(message, optimistic)}</span>
            </div>
          ) : null}
          {!user && assistantChrome.metaVisible ? (
            <div
              className='touch:pointer-events-auto touch:opacity-100 pointer-events-none mt-1.5 flex items-center gap-2 opacity-0 transition-opacity group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 group-hover/message:pointer-events-auto group-hover/message:opacity-100'
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
