import { useMutationState } from '@tanstack/react-query'

import { useChatTransport } from '@/features/chat/hooks/use-chat-transport'
import type { CheckpointRewindVariables } from '@/features/chat/hooks/use-checkpoint-rewind'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'

/** The user message whose checkpoint is being restored in this session, read from the rewind in flight. */
export function useRestoringCheckpoint(sessionId: string): string | null {
  const { environmentId } = useChatTransport()
  const targets = useMutationState({
    filters: { mutationKey: chatMutationKeys.rewind(environmentId, sessionId), status: 'pending' },
    select: (mutation) =>
      (mutation.state.variables as CheckpointRewindVariables | undefined)?.message.id ?? null,
  })
  return targets.at(-1) ?? null
}
