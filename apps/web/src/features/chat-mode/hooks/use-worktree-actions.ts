import { type ClientOrchestrationCommand, type ScopedWorktreeRef } from '@workspace/contracts'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { dispatchCommandForEnvironment } from '@/features/chat/state/active-transports'
import { dispatchChatCommand } from '@/features/chat/utils/command-dispatch'
import {
  worktreeActionCommand,
  confirmedWorktreeCommand,
  type WorktreeAction,
  type WorktreeConfirmation,
} from '@workspace/client-core/chat/worktrees/commands'
import { settleShellSnapshot } from '@/features/chat-mode/state/settle-shell-snapshot'
import { worktreeConfirmationPreview } from '@/features/chat-mode/transport/worktree-preview'
import { chatModeMutationKeys, chatWorktreeScope } from '@/features/chat-mode/utils/mutation-keys'
import { errorMessage } from '@/lib/error-message'

export function useWorktreeActions(ref: ScopedWorktreeRef) {
  const [confirmation, setConfirmation] = useState<WorktreeConfirmation | null>(null)
  const command = useMutation({
    mutationFn: async (command: ClientOrchestrationCommand) => {
      const result = await dispatchChatCommand({
        action: command.type,
        command,
        dispatchCommand: (command) => dispatchCommandForEnvironment(ref.environmentId, command),
      })
      await settleShellSnapshot(ref.environmentId)
      if (!result.ok) throw result.error
      return result.result
    },
    mutationKey: chatModeMutationKeys.worktree(ref.worktreeId),
    scope: { id: chatWorktreeScope(ref.worktreeId) },
  })
  const preview = useMutation({
    mutationFn: (kind: 'force' | 'missing') => worktreeConfirmationPreview(ref, kind),
    mutationKey: chatModeMutationKeys.worktreePreview(ref.worktreeId),
    onSuccess: setConfirmation,
  })

  function run(action: ClientOrchestrationCommand) {
    return command.mutateAsync(action).then(
      () => true,
      () => false,
    )
  }

  return {
    pending: command.isPending || preview.isPending,
    error: rowError(command.error, preview.error),
    confirmation,
    dismissConfirmation: () => setConfirmation(null),
    requestRelease: () => setConfirmation({ kind: 'release' }),
    preview: (kind: 'force' | 'missing') => preview.mutateAsync(kind).catch(() => undefined),
    run: (action: WorktreeAction) => run(worktreeActionCommand(action, ref.worktreeId)),
    async confirm() {
      if (!confirmation) return
      const accepted = await run(confirmedWorktreeCommand(ref.worktreeId, confirmation))
      if (accepted) setConfirmation(null)
    },
  }
}

function rowError(commandError: unknown, previewError: unknown) {
  if (commandError) return errorMessage(commandError, 'The worktree action failed.')
  if (previewError) return errorMessage(previewError, 'Could not prepare confirmation.')
  return null
}
