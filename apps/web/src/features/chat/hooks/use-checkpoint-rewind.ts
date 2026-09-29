import { useMutation } from '@tanstack/react-query'
import {
  MAX_CHAT_ATTACHMENTS,
  type OrchestrationMessage,
  type SessionId,
} from '@workspace/contracts'
import { createCheckpointRevertCommand } from '@workspace/client-core/chat/commands'
import { extractTerminalContexts } from '@workspace/client-core/chat/terminal-context'
import { extractReviewComments } from '@workspace/client-core/chat/review-comments'
import {
  useChatInputDraftStore,
  type ChatInputDraftTarget,
} from '@/features/chat/state/chat-input-draft-store'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import type { ChatTransport } from '@/features/chat/transport/chat-transport'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'
import { awaitRewind, prepareRewindAttachments } from '@/features/chat/utils/rewind'
import { dispatchChatCommand } from '@/features/chat/utils/command-dispatch'
import { confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'
import { createChatPipelineScope } from '@/features/chat/utils/pipeline-logging'
import { serverEndpoint } from '@/lib/client'
import { addReviewComment } from '@/lib/review-draft/state/store'
import { createClientInvariantError } from '@/lib/structured-errors'

export type CheckpointRewindVariables = {
  target: ChatInputDraftTarget & { draftKey: SessionId }
  message: OrchestrationMessage
  turnCount: number
  restoreFiles: boolean
}

export function useCheckpointRewind(transport: ChatTransport, sessionId: SessionId | null) {
  return useMutation({
    mutationKey: chatMutationKeys.rewind(transport.environmentId, sessionId),
    scope: { id: `chat-rewind:${transport.environmentId}:${sessionId}` },
    mutationFn: (variables: CheckpointRewindVariables) => rewind(transport, variables),
  })
}

// Outside the hook: React Compiler cannot lower the `try`/`finally` that closes the wide event.
async function rewind(
  transport: ChatTransport,
  { target, message, turnCount, restoreFiles }: CheckpointRewindVariables,
) {
  const scope = createChatPipelineScope('chat.checkpoint_rewind.summary', {
    sessionId: target.draftKey,
    environmentId: target.environmentId,
    turnCount,
    restoreFiles,
  })
  try {
    const drafts = useChatInputDraftStore.getState()
    const origin = confirmedEnvironmentOrigin(target.environmentId)
    const images = await prepareRewindAttachments(
      message,
      serverEndpoint(origin),
      drafts.getDraft(target).attachments.length,
    )
    if (drafts.getDraft(target).attachments.length + images.length > MAX_CHAT_ATTACHMENTS)
      throw createClientInvariantError(
        'The message box has too many attachments to take back this message’s images. Remove some and try again.',
      )
    const command = createCheckpointRevertCommand({
      sessionId: target.draftKey,
      turnCount,
      restoreFiles,
    })
    const outcome = await dispatchChatCommand({
      action: 'chat.checkpoint_revert.dispatch.summary',
      command,
      dispatchCommand: transport.dispatchCommand,
    })
    if (!outcome.ok) throw outcome.error
    const event = await awaitRewind(transport, command, outcome.result.sequence)
    useChatProjectionStore.getState().applyOrchestrationEvents(target.environmentId, [event])
    const original = extractTerminalContexts(message.text)
    const review = extractReviewComments(original.text)
    drafts.restoreContent(target, {
      prompt: review.text,
      attachments: images,
      terminalContexts: original.contexts.map((context) => ({
        ...context,
        id: crypto.randomUUID(),
      })),
    })
    for (const comment of review.comments)
      addReviewComment({
        ...comment,
        destination: { environmentId: target.environmentId, rootPath: target.rootPath },
      })
    scope.set({ outcome: 'ok', restoredImageCount: images.length })
  } catch (error) {
    scope.warn('Checkpoint rewind failed.', { error })
    scope.set({ outcome: 'error' })
    throw error
  } finally {
    scope.end()
  }
}
