import * as v from 'valibot'
import {
  commandIdSchema,
  terminalLeaseIdSchema,
  type TerminalLeaseId,
  type OrchestrationCommand,
  type WorktreeId,
} from '@workspace/contracts'
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
}

export class TerminalLeaseController {
  readonly runtimeEpoch = crypto.randomUUID()

  private readonly options: TerminalLeaseControllerOptions

  constructor(options: TerminalLeaseControllerOptions) {
    this.options = options
  }

  async begin(worktreeId: WorktreeId): Promise<TerminalExecutionLease> {
    const terminalLeaseId = v.parse(terminalLeaseIdSchema, crypto.randomUUID())
    const send = (type: TerminalCommand['type']) =>
      this.send(type, worktreeId, terminalLeaseId, this.runtimeEpoch)
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
    return {
      terminalLeaseId,
      runtimeEpoch: this.runtimeEpoch,
      activate: () => ended ?? enqueue('terminal.lease.activate'),
      terminate: () => ended ?? enqueue('terminal.lease.terminate'),
      end: () => {
        // A rejected end is forgotten, so the terminal's reconnect retry writes it again.
        ended ??= enqueue('terminal.lease.end')
          .finally(() => shared.release())
          .catch((error: unknown) => {
            ended = null
            throw error
          })
        return ended
      },
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

  async recover() {
    for (const lease of this.options.getReadModel().terminalLeases.values()) {
      if (
        lease.runtimeEpoch === this.runtimeEpoch ||
        lease.state === 'ended' ||
        lease.state === 'ownership-unknown'
      )
        continue
      const type =
        lease.state === 'requested' ? 'terminal.lease.end' : 'terminal.lease.mark-unknown'
      await this.send(type, lease.worktreeId, lease.terminalLeaseId, lease.runtimeEpoch)
    }
  }

  async endRecovered(terminalLeaseId: TerminalLeaseId) {
    const lease = this.options.getReadModel().terminalLeases.get(terminalLeaseId)
    if (!lease || lease.state === 'ended') return
    await this.send('terminal.lease.end', lease.worktreeId, terminalLeaseId, lease.runtimeEpoch)
  }

  private send(
    type: TerminalCommand['type'],
    worktreeId: WorktreeId,
    terminalLeaseId: TerminalLeaseId,
    runtimeEpoch: string,
  ) {
    return this.options.dispatch({
      type,
      worktreeId,
      terminalLeaseId,
      runtimeEpoch,
      commandId: v.parse(commandIdSchema, internalCommandKey(type, terminalLeaseId, runtimeEpoch)),
    })
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
