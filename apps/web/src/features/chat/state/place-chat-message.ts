import type { ClientOrchestrationCommand, OrchestrationDispatchResult } from '@workspace/contracts'
import { runIntent } from '@workspace/client-core/optimistic/run'

import { log } from '@/lib/client-logging'
import {
  dispatchChatCommand,
  type ChatCommandDispatchOutcome,
  type DispatchCommand,
} from '@/features/chat/utils/command-dispatch'
import { optimisticMessageSummary } from '@/features/chat/utils/pipeline-logging'
import {
  chatMessageIntents,
  chatMessageResource,
  type ChatMessagePlacement,
} from '@/features/chat/state/chat-message-intents'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'

const CHAT_MESSAGE_ACKNOWLEDGEMENT_TIMEOUT_MS = 10_000

/**
 * The one way a user message reaches the server. The message is on screen from
 * the first line and stays until the session's projection carries its id,
 * which is the acknowledgement; a refused dispatch or a projection that never
 * catches up withdraws it.
 *
 * Resolves on the dispatch outcome, not the acknowledgement: the composer is
 * free again the moment the server accepts, and the intent keeps holding the
 * message on its own.
 */
export function placeChatMessage({
  action,
  command,
  context,
  dispatchCommand,
  onAccepted,
  placement,
}: {
  readonly action: string
  readonly command: ClientOrchestrationCommand
  readonly context?: Record<string, unknown>
  readonly dispatchCommand: DispatchCommand
  readonly onAccepted?: (result: OrchestrationDispatchResult) => void
  readonly placement: ChatMessagePlacement
}): Promise<ChatCommandDispatchOutcome> {
  const { environmentId, message } = placement
  const summary = optimisticMessageSummary({
    commandId: placement.commandId,
    messageId: message.id,
    textLength: message.text.length,
    sessionId: message.sessionId,
  })

  return new Promise((resolve) => {
    void runIntent(chatMessageIntents, placement, {
      resources: [chatMessageResource(placement)],
      perform: async () => {
        const outcome = await dispatchChatCommand({
          action,
          command,
          context: { ...context, optimistic: summary },
          dispatchCommand,
          onAccepted,
        })
        resolve(outcome)
        if (!outcome.ok) throw outcome.error
        return outcome.result
      },
      until: {
        subscribe: useChatProjectionStore.subscribe,
        satisfied: () =>
          selectChatProjectionSlice(
            useChatProjectionStore.getState(),
            environmentId,
          ).messageIdsBySessionId[message.sessionId]?.includes(message.id) === true,
        timeoutMs: CHAT_MESSAGE_ACKNOWLEDGEMENT_TIMEOUT_MS,
      },
      record: (event) =>
        log[event.outcome === 'acknowledged' ? 'debug' : 'warn']({
          action: 'chat.message.intent',
          area: 'chat',
          pipeline: 'chat',
          ...summary,
          ...event,
        }),
    })
  })
}
