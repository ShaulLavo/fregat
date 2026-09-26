import * as v from 'valibot'
import {
  commandIdSchema,
  terminalLeaseIdSchema,
  type TerminalLease,
  type TerminalLeaseId,
  type OrchestrationCommand,
  type WorktreeId,
} from '@workspace/contracts'
import type { HostSessionInfo } from '../terminal-host/protocol'
import type { TerminalExecutionLease } from '../terminal/lease'
import { recordProcessWarning } from '../observability'
import { orchestrationErrors } from '../observability/structured-errors'
import type { WorktreeExecutionGate } from './worktree-execution-gate'
import { internalCommandKey } from './utils/repository-ids'
import type { OrchestrationReadModel } from './read-model'
import { isDurableCommandRejection } from './command-receipts'

type TerminalCommand = Extract<OrchestrationCommand, { type: `terminal.lease.${string}` }>

// 250 ms doubling: about four seconds before a failing store is reported instead of retried.
const PERSIST_ATTEMPTS = 5
const PERSIST_FIRST_DELAY_MS = 250

type TerminalLeaseControllerOptions = {
  gate: WorktreeExecutionGate
  dispatch: (command: OrchestrationCommand) => Promise<unknown>
  getReadModel: () => OrchestrationReadModel
  /** Null when the host is unreachable or this process has no host client at all. */
  queryHostSessions?: () => Promise<readonly HostSessionInfo[] | null>
}

export class TerminalLeaseController {
  readonly runtimeEpoch = crypto.randomUUID()

  private readonly options: TerminalLeaseControllerOptions

  constructor(options: TerminalLeaseControllerOptions) {
    this.options = options
  }

  async begin(worktreeId: WorktreeId, key?: string): Promise<TerminalExecutionLease> {
    const terminalLeaseId = v.parse(terminalLeaseIdSchema, crypto.randomUUID())
    const send = (type: TerminalCommand['type']) =>
      this.send(
        type,
        worktreeId,
        terminalLeaseId,
        this.runtimeEpoch,
        type === 'terminal.lease.request' ? { key } : {},
      )
    await this.untilAccepted(send, 'terminal.lease.request')
    const shared = await this.acquireShared(worktreeId, send)
    try {
      await this.untilAccepted(send, 'terminal.lease.claim')
    } catch (error) {
      await this.endAfterFailure(send).finally(() => shared.release())
      throw error
    }
    let ended: Promise<void> | null = null
    let queue = Promise.resolve()
    const enqueue = (type: TerminalCommand['type']) => {
      queue = queue.catch(() => {}).then(() => this.untilAccepted(send, type))
      return queue
    }
    // A rejected end is forgotten, so the terminal's reconnect retry writes it again.
    const finish = (type: TerminalCommand['type']) => {
      ended ??= enqueue(type)
        .finally(() => shared.release())
        .catch((error: unknown) => {
          ended = null
          throw error
        })
      return ended
    }
    return {
      terminalLeaseId,
      runtimeEpoch: this.runtimeEpoch,
      activate: () => ended ?? enqueue('terminal.lease.activate'),
      terminate: () => ended ?? enqueue('terminal.lease.terminate'),
      end: () => finish('terminal.lease.end'),
      markUnknown: () => finish('terminal.lease.mark-unknown'),
    }
  }

  private async acquireShared(
    worktreeId: WorktreeId,
    send: (type: TerminalCommand['type']) => Promise<unknown>,
  ) {
    try {
      return this.options.gate.acquireShared(worktreeId, 'terminal')
    } catch (error) {
      await this.endAfterFailure(send)
      throw error
    }
  }

  /**
   * At boot, a lease from a stale epoch is adopted when the host still runs its shell, ended
   * when the host proves it exited, and only left `ownership-unknown` when the host cannot
   * be reached at all — that is the one case nothing here can verify.
   */
  async recover() {
    const sessions = await this.hostSessions()
    const live = sessions
      ? new Set(sessions.filter((session) => !session.exited).map((session) => session.key))
      : null
    const leases = [...this.options.getReadModel().terminalLeases.values()].sort(
      (a, b) =>
        Number(b.runtimeEpoch === this.runtimeEpoch) -
          Number(a.runtimeEpoch === this.runtimeEpoch) ||
        b.createdAt.localeCompare(a.createdAt) ||
        b.terminalLeaseId.localeCompare(a.terminalLeaseId),
    )
    for (const lease of leases) {
      if (lease.state === 'ended') continue
      if (lease.runtimeEpoch === this.runtimeEpoch) {
        if (lease.key) live?.delete(lease.key)
        continue
      }
      await this.recoverLease(lease, live)
    }
  }

  private async recoverLease(lease: TerminalLease, live: Set<string> | null) {
    if (lease.state === 'requested') {
      await this.send(
        'terminal.lease.end',
        lease.worktreeId,
        lease.terminalLeaseId,
        lease.runtimeEpoch,
      )
      return
    }
    if (!live || !lease.key) {
      if (lease.state === 'ownership-unknown') return
      await this.send(
        'terminal.lease.mark-unknown',
        lease.worktreeId,
        lease.terminalLeaseId,
        lease.runtimeEpoch,
      )
      return
    }
    if (live.has(lease.key)) {
      await this.adopt(lease.worktreeId, lease.terminalLeaseId, lease.runtimeEpoch)
      // One host key has one owner; older leases for a replaced shell are finished below.
      live.delete(lease.key)
      return
    }
    await this.send(
      'terminal.lease.end',
      lease.worktreeId,
      lease.terminalLeaseId,
      lease.runtimeEpoch,
      {
        hostConfirmedGone: true,
      },
    )
  }

  async endRecovered(terminalLeaseId: TerminalLeaseId) {
    const lease = this.options.getReadModel().terminalLeases.get(terminalLeaseId)
    if (!lease || lease.state === 'ended') return
    await this.send('terminal.lease.end', lease.worktreeId, terminalLeaseId, lease.runtimeEpoch, {
      hostConfirmedGone: true,
    })
  }

  /** Moves a lease from `fromRuntimeEpoch` to this process's epoch; the host proved it alive. */
  async adopt(worktreeId: WorktreeId, terminalLeaseId: TerminalLeaseId, fromRuntimeEpoch: string) {
    await this.send('terminal.lease.adopt', worktreeId, terminalLeaseId, this.runtimeEpoch, {
      fromRuntimeEpoch,
    })
  }

  /** A lease handle for a lease this process already adopted, skipping request/claim. */
  attachAdopted(worktreeId: WorktreeId, terminalLeaseId: TerminalLeaseId): TerminalExecutionLease {
    const shared = this.options.gate.acquireShared(worktreeId, 'terminal')
    let ended: Promise<void> | null = null
    const send = (type: TerminalCommand['type']) =>
      this.send(type, worktreeId, terminalLeaseId, this.runtimeEpoch)
    const finish = (type: TerminalCommand['type']) => {
      ended ??= this.untilAccepted(send, type)
        .finally(() => shared.release())
        .catch((error: unknown) => {
          ended = null
          throw error
        })
      return ended
    }
    return {
      terminalLeaseId,
      runtimeEpoch: this.runtimeEpoch,
      // Adopting already left the lease active; nothing to claim first.
      activate: () => Promise.resolve(),
      terminate: () => ended ?? this.untilAccepted(send, 'terminal.lease.terminate'),
      end: () => finish('terminal.lease.end'),
      markUnknown: () => finish('terminal.lease.mark-unknown'),
    }
  }

  private async hostSessions(): Promise<readonly HostSessionInfo[] | null> {
    if (!this.options.queryHostSessions) return null
    try {
      return await this.options.queryHostSessions()
    } catch {
      return null
    }
  }

  private send(
    type: TerminalCommand['type'],
    worktreeId: WorktreeId,
    terminalLeaseId: TerminalLeaseId,
    runtimeEpoch: string,
    extra: Record<string, unknown> = {},
  ) {
    return this.options.dispatch({
      type,
      worktreeId,
      terminalLeaseId,
      runtimeEpoch,
      ...extra,
      commandId: v.parse(commandIdSchema, internalCommandKey(type, terminalLeaseId, runtimeEpoch)),
    } as OrchestrationCommand)
  }

  /** Cleanup for a lease that failed to start: the original failure is the one to report. */
  private async endAfterFailure(send: (type: TerminalCommand['type']) => Promise<unknown>) {
    try {
      await this.untilAccepted(send, 'terminal.lease.end')
    } catch (error) {
      recordProcessWarning('terminal.lease.cleanup_failed', {
        area: 'terminal',
        command: 'terminal.lease.end',
        error,
        operation: 'lease',
      })
    }
  }

  private async untilAccepted(
    send: (type: TerminalCommand['type']) => Promise<unknown>,
    type: TerminalCommand['type'],
  ) {
    let lastError: unknown
    for (let attempt = 1; ; attempt += 1) {
      try {
        await send(type)
        if (attempt > 1) recordPersistenceRetried(type, attempt, lastError)
        return
      } catch (error) {
        if (isDurableCommandRejection(error)) throw error
        lastError = error
        if (attempt >= PERSIST_ATTEMPTS) throw persistenceFailed(type, attempt, error)
        const delay = PERSIST_FIRST_DELAY_MS * 2 ** (attempt - 1)
        await new Promise<void>((resolve) => setTimeout(resolve, delay))
      }
    }
  }
}

function recordPersistenceRetried(
  command: TerminalCommand['type'],
  attempts: number,
  error: unknown,
) {
  recordProcessWarning('terminal.lease.persistence_retried', {
    area: 'terminal',
    attempts,
    command,
    error,
    operation: 'lease',
  })
}

function persistenceFailed(command: TerminalCommand['type'], attempts: number, cause: unknown) {
  return orchestrationErrors.TERMINAL_LEASE_UNPERSISTED({
    attempts,
    command,
    ...(cause instanceof Error ? { cause } : { internal: { cause: String(cause) } }),
  })
}
