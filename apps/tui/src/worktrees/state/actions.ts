import { createObservableStore } from '@/host/state/observable-store'
import * as v from 'valibot'
import {
  errorStringField,
  worktreeCleanupPreviewSchema,
  worktreeMissingPreviewSchema,
  type ClientOrchestrationCommand,
  type WorktreeId,
} from '@workspace/contracts'
import type { ChatOwner } from '@workspace/client-core/chat/owner'
import {
  confirmedWorktreeCommand,
  worktreeActionCommand,
} from '@workspace/client-core/chat/worktrees/commands'
import { requireEdenData } from '@workspace/client-core/transport/eden'
import type { SettingsSession } from '@/connection/state/session'
import { worktreeActions, type WorktreeAction } from '@workspace/client-core/chat/worktrees/actions'
import type { CleanupConfirmation } from '@workspace/client-core/chat/worktrees/confirmation'

type Snapshot = {
  readonly pending: boolean
  readonly error: string | null
  readonly confirmation: CleanupConfirmation | null
}

export function createWorktreeActions({
  session,
  chat,
  worktreeId,
  currentWorktreeId,
}: {
  readonly session: SettingsSession
  readonly chat: ChatOwner
  readonly worktreeId: WorktreeId
  readonly currentWorktreeId: WorktreeId | null
}) {
  const lifetime = new AbortController()
  const store = createObservableStore<Snapshot>(
    { pending: false, error: null, confirmation: null },
    { signal: lifetime.signal },
  )

  const publish = store.patch

  function allowed(action: WorktreeAction) {
    const connection = session.getSnapshot()
    if (connection.kind !== 'ready' || connection.connection.kind !== 'live') {
      publish({ error: 'Reconnect before changing worktrees.' })
      return false
    }
    const worktree = chat.getSnapshot().projection.worktreeById[worktreeId]
    const available = worktree && worktreeActions(worktree, worktreeId === currentWorktreeId)
    if (available?.some((option) => option.value === action)) return true
    publish({ error: 'This action is no longer available. Review the current worktree status.' })
    return false
  }

  async function perform(operation: () => Promise<void>) {
    if (store.value.pending || lifetime.signal.aborted) return
    publish({ pending: true, error: null })
    try {
      await operation()
    } catch (error) {
      publish({ error: errorStringField(error, 'message') ?? 'The worktree operation failed.' })
    } finally {
      publish({ pending: false })
    }
  }

  async function dispatch(command: ClientOrchestrationCommand) {
    await chat.dispatch(command)
    publish({ confirmation: null })
  }

  async function preview(kind: 'force' | 'missing') {
    const query = { worktreeId }
    const fetch = { signal: AbortSignal.any([session.signal, lifetime.signal]) }
    if (kind === 'force') {
      const response = await session.client.orchestration['worktree-cleanup-preview'].get({
        query,
        fetch,
      })
      const preview = v.parse(worktreeCleanupPreviewSchema, requireEdenData(response))
      publish({ confirmation: { kind, preview } })
      return
    }
    const response = await session.client.orchestration['worktree-missing-preview'].get({
      query,
      fetch,
    })
    const preview = v.parse(worktreeMissingPreviewSchema, requireEdenData(response))
    publish({ confirmation: { kind, preview } })
  }

  async function request(action: WorktreeAction) {
    if (store.value.pending || !allowed(action)) return
    if (action === 'cleanup' || action === 'release') {
      publish({ confirmation: { kind: action === 'cleanup' ? 'safe' : 'release' }, error: null })
      return
    }
    if (action === 'force' || action === 'missing') return perform(() => preview(action))
    const worktree = chat.getSnapshot().projection.worktreeById[worktreeId]
    if (!worktree) return
    const option = worktreeActions(worktree, worktreeId === currentWorktreeId).find(
      (item) => item.value === action,
    )
    if (option?.kind !== 'run') return
    return perform(() => dispatch(worktreeActionCommand(option.command, worktreeId)))
  }

  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    request,
    dismiss() {
      if (!store.value.pending) publish({ confirmation: null, error: null })
    },
    async confirm() {
      const confirmation = store.value.confirmation
      if (!confirmation || !allowed(confirmation.kind === 'safe' ? 'cleanup' : confirmation.kind))
        return
      const command =
        confirmation.kind === 'safe'
          ? worktreeActionCommand('worktree.cleanup', worktreeId)
          : confirmedWorktreeCommand(worktreeId, confirmation)
      return perform(() => dispatch(command))
    },
    dispose() {
      lifetime.abort()
      store.dispose()
    },
  }
}
