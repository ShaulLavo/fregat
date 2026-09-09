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
import { worktreeActions, type WorktreeAction } from '@/worktrees/utils/choices'
import type { CleanupConfirmation } from '@/worktrees/utils/confirmation'

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
  const listeners = new Set<() => void>()
  const lifetime = new AbortController()
  let snapshot: Snapshot = { pending: false, error: null, confirmation: null }

  function publish(patch: Partial<Snapshot>) {
    if (lifetime.signal.aborted) return
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener()
  }

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
    if (snapshot.pending || lifetime.signal.aborted) return
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
    if (snapshot.pending || !allowed(action)) return
    if (action === 'cleanup' || action === 'release') {
      publish({ confirmation: { kind: action === 'cleanup' ? 'safe' : 'release' }, error: null })
      return
    }
    if (action === 'force' || action === 'missing') return perform(() => preview(action))
    const worktree = chat.getSnapshot().projection.worktreeById[worktreeId]
    let type: 'worktree.retry' | 'worktree.cleanup' | 'worktree.retain' | 'worktree.adopt' =
      'worktree.retry'
    if (action === 'retry' && worktree?.lifecycle.state !== 'creation-failed')
      type = 'worktree.cleanup'
    if (action === 'retain') type = 'worktree.retain'
    if (action === 'adopt') type = 'worktree.adopt'
    return perform(() => dispatch(worktreeActionCommand(type, worktreeId)))
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    request,
    dismiss() {
      if (!snapshot.pending) publish({ confirmation: null, error: null })
    },
    async confirm() {
      const confirmation = snapshot.confirmation
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
      listeners.clear()
    },
  }
}
