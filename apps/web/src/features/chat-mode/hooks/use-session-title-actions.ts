import { useMutation } from '@tanstack/react-query'
import type { ScopedSessionRef } from '@workspace/contracts'
import { createSessionRegenerateTitleCommand } from '@workspace/client-core/chat/commands'
import { toast } from 'sonner'
import { notifyChatCommandError } from '@/features/chat/notify-command-error'
import { settleShellSnapshot } from '@/features/chat-mode/state/settle-shell-snapshot'
import { dispatchChatCommand } from '@/features/chat/utils/command-dispatch'
import { dispatchCommandForEnvironment } from '@/features/chat/state/active-transports'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { sessionTitlePolicy } from '@/features/chat-mode/utils/session-title'
import { chatModeMutationKeys } from '@/features/chat-mode/utils/mutation-keys'
import { removeSuccessfulSelection } from '@/features/chat-mode/state/session-multi-select-store'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'

export function useSessionTitleActions() {
  return useMutation(
    {
      mutationKey: chatModeMutationKeys.regenerateTitle(),
      scope: { id: 'chat.session.title' },
      mutationFn: async (refs: readonly ScopedSessionRef[]) => {
        const accepted: ScopedSessionRef[] = []
        let skipped = 0
        let failed = 0
        for (const ref of refs) {
          const owner = Object.values(useEnvironmentsStore.getState().entries).find(
            (entry) => entry.environmentId === ref.environmentId,
          )
          const session = selectChatProjectionSlice(
            useChatProjectionStore.getState(),
            ref.environmentId,
          ).sessionById[ref.sessionId]
          const policy = sessionTitlePolicy(session, owner)
          if (!policy.supported || policy.pending) {
            skipped++
            continue
          }
          const result = await dispatchChatCommand({
            action: 'chat.session.regenerateTitle',
            command: createSessionRegenerateTitleCommand(ref.sessionId),
            dispatchCommand: (command) => dispatchCommandForEnvironment(ref.environmentId, command),
          })
          if (!result.ok) {
            failed++
            continue
          }
          await settleShellSnapshot(ref.environmentId)
          accepted.push(ref)
        }
        removeSuccessfulSelection(accepted)
        return { accepted, skipped, failed }
      },
      onError: (error) => notifyChatCommandError(error, 'Title request failed'),
      onSuccess: ({ accepted, skipped, failed }) => {
        toast(
          `${accepted.length} title request${accepted.length === 1 ? '' : 's'} accepted${skipped ? `, ${skipped} skipped` : ''}${failed ? `, ${failed} failed` : ''}`,
        )
      },
    },
    primaryQueryClient(),
  )
}
