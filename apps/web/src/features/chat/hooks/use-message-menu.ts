import { useIsMutating } from '@tanstack/react-query'
import type { OrchestrationMessage } from '@workspace/contracts'

import { useChatTimelineActions } from '@/features/chat/hooks/use-chat-timeline-actions'
import { useChatTransport } from '@/features/chat/hooks/use-chat-transport'
import { useForkSession } from '@/features/chat/hooks/use-fork-session'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import {
  copySessionTranscript,
  downloadSessionTranscript,
} from '@/features/chat/state/transcript-export'
import { checkpointAvailability } from '@/lib/checkpoint-availability'
import type { OptimisticChatMessage } from '@/features/chat/state/chat-message-intents'
import type { ChatTurnDiffSummary } from '@workspace/client-core/chat/types'
import { messageMarkdown } from '@/features/chat/utils/message-markdown'
import { chatMessageMenu } from '@/features/chat/utils/message-menu'
import { markdownToPlainText } from '@/features/chat/utils/message-text'
import { copyTextToClipboard } from '@/lib/clipboard'
import { errorMessage } from '@/lib/error-message'
import { toastError } from '@/lib/toast-error'

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
  const { environmentId } = useChatTransport()
  const sessionRef = { environmentId, sessionId: message.sessionId }
  const fork = useForkSession(message.sessionId)
  const forking =
    useIsMutating({ mutationKey: chatMutationKeys.fork(environmentId, message.sessionId) }) > 0
  const latestTurn = useChatProjectionStore(
    (state) =>
      selectChatProjectionSlice(state, environmentId).sessionById[message.sessionId]?.latestTurn,
  )
  const turnId = message.turnId
  const turnRunning = latestTurn?.turnId === turnId && latestTurn?.state === 'running'
  const assistant = message.role === 'assistant'
  const text = messageMarkdown(message)

  function handleRevertToCheckpoint() {
    if (typeof revertTurnCount !== 'number') return

    revertToCheckpoint(revertTurnCount, message.id)
  }

  async function handleViewChangedFiles() {
    if (!turnDiffSummary) return

    try {
      await openCheckpointDiff(turnDiffSummary)
    } catch (error) {
      // The inline changed-files card reports this in place; a dismissed menu
      // has nowhere to put it, so it surfaces as a toast instead.
      toastError(errorMessage(error, 'Checkpoint diff unavailable.'))
    }
  }

  return chatMessageMenu({
    canRevertCheckpoint: typeof revertTurnCount === 'number',
    canViewChangedFiles: checkpointAvailability(turnDiffSummary).kind === 'available',
    canFork: turnId !== null && !turnRunning,
    fork: () => {
      if (turnId) fork.mutate(turnId)
    },
    forkPending: forking,
    copyConversation: () => void copySessionTranscript(sessionRef),
    exportConversation: () => void downloadSessionTranscript(sessionRef, 'markdown'),
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
