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
import type { WorktreeExecutionGate } from './worktree-execution-gate'
import { internalCommandKey } from './utils/repository-ids'
import type { OrchestrationReadModel } from './read-model'
import { isDurableCommandRejection } from './command-receipts'

type TerminalCommand = Extract<OrchestrationCommand, { type: `terminal.lease.${string}` }>

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
    await this.untilAccepted(() => send('terminal.lease.request'))
    const shared = await this.acquireShared(worktreeId, send)
    try {
      await this.untilAccepted(() => send('terminal.lease.claim'))
    } catch (error) {
      await this.untilAccepted(() => send('terminal.lease.end'))
      shared.release()
      throw error
    }
    let ended: Promise<void> | null = null
    let queue = Promise.resolve()
    const enqueue = (type: TerminalCommand['type']) => {
      queue = queue.catch(() => {}).then(() => this.untilAccepted(() => send(type)))
      return queue
    }
    return {
      terminalLeaseId,
      runtimeEpoch: this.runtimeEpoch,
      activate: () => ended ?? enqueue('terminal.lease.activate'),
      terminate: () => ended ?? enqueue('terminal.lease.terminate'),
      end: () => {
        ended ??= enqueue('terminal.lease.end').then(() => shared.release())
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
      await this.untilAccepted(() => send('terminal.lease.end'))
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

  private async untilAccepted(operation: () => Promise<unknown>) {
    for (;;) {
      try {
        await operation()
        return
      } catch (error) {
        if (isDurableCommandRejection(error)) throw error
        recordProcessWarning('terminal.lease.persistence_failed', {
          area: 'terminal',
          operation: 'lease',
          error,
        })
        await new Promise<void>((resolve) => setTimeout(resolve, 250))
      }
    }
  }
}
