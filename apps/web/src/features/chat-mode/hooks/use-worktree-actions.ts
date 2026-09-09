import { type ClientOrchestrationCommand, type ScopedWorktreeRef } from '@workspace/contracts'
import { useState } from 'react'
import { dispatchCommandForEnvironment } from '@/features/chat/state/active-transports'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { fetchOrchestrationShellSnapshotHttp } from '@/features/chat/transport/orchestration-http-snapshots'
import { dispatchChatCommand } from '@/features/chat/utils/command-dispatch'
import {
  worktreeActionCommand,
  confirmedWorktreeCommand,
  type WorktreeAction,
  type WorktreeConfirmation,
} from '@workspace/client-core/chat/worktrees/commands'
import { environmentClientFor } from '@/lib/client'
import { confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'
import { worktreeConfirmationPreview } from '@/features/chat-mode/transport/worktree-preview'
import { errorMessage } from '@/lib/error-message'

export function useWorktreeActions(ref: ScopedWorktreeRef) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<WorktreeConfirmation | null>(null)

  async function refresh() {
    const client = environmentClientFor(confirmedEnvironmentOrigin(ref.environmentId))
    const snapshot = await fetchOrchestrationShellSnapshotHttp(client)
    useChatProjectionStore.getState().syncShellSnapshot(ref.environmentId, snapshot)
  }

  async function dispatch(command: ClientOrchestrationCommand) {
    setPending(true)
    setError(null)
    const result = await dispatchChatCommand({
      action: command.type,
      command,
      dispatchCommand: (command) => dispatchCommandForEnvironment(ref.environmentId, command),
    })
    if (!result.ok) setError(result.message)
    try {
      await refresh()
    } catch (error) {
      setError(errorMessage(error, 'Could not refresh worktrees.'))
    }
    setPending(false)
    return result.ok
  }

  async function preview(kind: 'force' | 'missing') {
    setPending(true)
    setError(null)
    try {
      setConfirmation(await worktreeConfirmationPreview(ref, kind))
    } catch (error) {
      setError(errorMessage(error, 'Could not prepare confirmation.'))
    } finally {
      setPending(false)
    }
  }

  return {
    pending,
    error,
    confirmation,
    dismissConfirmation: () => setConfirmation(null),
    requestRelease: () => setConfirmation({ kind: 'release' }),
    preview,
    run: (action: WorktreeAction) => dispatch(worktreeActionCommand(action, ref.worktreeId)),
    async confirm() {
      if (!confirmation) return
      const accepted = await dispatch(confirmedWorktreeCommand(ref.worktreeId, confirmation))
      if (accepted) setConfirmation(null)
    },
  }
}
