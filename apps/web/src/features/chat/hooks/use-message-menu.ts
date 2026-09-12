import type { OrchestrationMessage } from '@workspace/contracts'
import { toast } from 'sonner'

import { useChatTimelineActions } from '@/features/chat/hooks/use-chat-timeline-actions'
import { canOpenCheckpointDiff } from '@/features/chat/utils/checkpoint-diff-query'
import type { OptimisticChatMessage } from '@/features/chat/state/chat-optimistic-store'
import type { ChatTurnDiffSummary } from '@workspace/client-core/chat/types'
import { extractTerminalContexts } from '@workspace/client-core/chat/terminal-context'
import { chatMessageMenu } from '@/features/chat/utils/message-menu'
import { markdownToPlainText } from '@/features/chat/utils/message-text'
import { copyTextToClipboard } from '@/lib/clipboard'
import { errorMessage } from '@/lib/error-message'
import { codexFileCitationsMarkdown } from '@/features/chat/utils/codex-file-citations'

export function useMessageMenu({
  checkpointRevertPending,
  message,
  revertTurnCount,
  turnDiffSummary,
}: {
  readonly checkpointRevertPending: boolean
  readonly message: OrchestrationMessage | OptimisticChatMessage
  readonly revertTurnCount: number | null
  readonly turnDiffSummary: ChatTurnDiffSummary | null
}) {
  const { openCheckpointDiff, revertToCheckpoint } = useChatTimelineActions()
  const assistant = message.role === 'assistant'
  // Copy hands over what the bubble shows. For a user message that is the
  // prompt without the attached `<terminal_context>` block.
  const text = assistant
    ? codexFileCitationsMarkdown(message.text)
    : extractTerminalContexts(message.text).text

  function handleRevertToCheckpoint() {
    if (typeof revertTurnCount !== 'number') return

    revertToCheckpoint(revertTurnCount)
  }

  async function handleViewChangedFiles() {
    if (!turnDiffSummary) return

    try {
      await openCheckpointDiff(turnDiffSummary)
    } catch (error) {
      // The inline changed-files card reports this in place; a dismissed menu
      // has nowhere to put it, so it surfaces as a toast instead.
      toast.error(errorMessage(error, 'Checkpoint diff unavailable.'))
    }
  }

  return chatMessageMenu({
    canRevertCheckpoint: typeof revertTurnCount === 'number',
    canViewChangedFiles: turnDiffSummary !== null && canOpenCheckpointDiff(turnDiffSummary),
    copyMarkdown: () => void copyTextToClipboard(text, 'message markdown'),
    copyText: () =>
      void copyTextToClipboard(assistant ? markdownToPlainText(text) : text, 'message'),
    hasText: text.trim().length > 0,
    isAssistant: assistant,
    revertPending: checkpointRevertPending,
    revertToCheckpoint: handleRevertToCheckpoint,
    viewChangedFiles: () => void handleViewChangedFiles(),
  })
}
