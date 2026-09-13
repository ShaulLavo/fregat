import {
  scopedSessionKey,
  type CommandId,
  type EnvironmentId,
  type OrchestrationMessage,
  type ScopedSessionRef,
} from '@workspace/contracts'
import {
  createIntentQueue,
  pendingIntents,
  type IntentQueueState,
} from '@workspace/client-core/optimistic/queue'
import { watchIntentHolds } from '@/lib/optimistic/hold-diagnostics'

/** A user message shown before the server's projection carries it. */
export type ChatMessagePlacement = {
  readonly environmentId: EnvironmentId
  readonly commandId: CommandId
  readonly message: OrchestrationMessage
}

export type OptimisticChatMessage = OrchestrationMessage & {
  commandId: CommandId
  optimistic: true
}

export const chatMessageIntents = watchIntentHolds(createIntentQueue<ChatMessagePlacement>(), {
  area: 'chat',
  describe: (placement) => `message ${placement.message.id}`,
})

const EMPTY_OPTIMISTIC_MESSAGES: OptimisticChatMessage[] = []

export function chatMessageResource(placement: ChatMessagePlacement) {
  return `${placementSessionKey(placement)}/${placement.message.id}`
}

export function resetChatMessageIntents() {
  chatMessageIntents.reset()
}

/**
 * Pending messages for one session. Identity-stable while the queue's active
 * list is unchanged, so the timeline's row sharing keeps working.
 */
export function createOptimisticMessagesForSessionSelector(
  ref: ScopedSessionRef | null | undefined,
) {
  const sessionKey = ref ? scopedSessionKey(ref) : null
  let previousActive: IntentQueueState<ChatMessagePlacement>['active'] | undefined
  let previousMessages: OptimisticChatMessage[] = EMPTY_OPTIMISTIC_MESSAGES

  return (state: IntentQueueState<ChatMessagePlacement>) => {
    if (!sessionKey) return EMPTY_OPTIMISTIC_MESSAGES
    if (previousActive === state.active) return previousMessages

    previousActive = state.active
    const messages = pendingIntents(state.active).flatMap(({ patch }) => {
      if (placementSessionKey(patch) !== sessionKey) return []
      return [{ ...patch.message, commandId: patch.commandId, optimistic: true as const }]
    })
    previousMessages = messages.length > 0 ? messages : EMPTY_OPTIMISTIC_MESSAGES

    return previousMessages
  }
}

function placementSessionKey(placement: ChatMessagePlacement) {
  return scopedSessionKey({
    environmentId: placement.environmentId,
    sessionId: placement.message.sessionId,
  })
}
