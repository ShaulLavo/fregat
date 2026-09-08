import { eq } from 'drizzle-orm'
import * as v from 'valibot'
import type { OrchestrationCommand, OrchestrationCommandReceipt } from './schemas'
import { orchestrationCommandReceiptSchema } from './schemas'
import { getDefaultPlatformDatabase } from '../db/client'
import { isEvlogError } from '../observability'
import type { ProjectRegistrationResult, ClientOrchestrationCommand } from '@workspace/contracts'
import { commandFingerprint } from './utils/command-intent'
import { sessionDomainErrors } from './structured-errors'
import { orchestrationCommandReceipts, type OrchestrationCommandReceiptRow } from '../db/schema'
import type { OrchestrationDatabase } from './event-store'
import {
  orchestrationCommandSummary,
  recordChatPipelineInfo,
  recordChatPipelineWarning,
} from './orchestration-logging'

type ReceiptCommand =
  | OrchestrationCommand
  | Exclude<ClientOrchestrationCommand, { type: 'project.create' }>

export class OrchestrationCommandReceipts {
  private readonly database: OrchestrationDatabase

  constructor(database: OrchestrationDatabase = getDefaultPlatformDatabase()) {
    this.database = database
  }

  find(commandId: string) {
    const row = this.database
      .select()
      .from(orchestrationCommandReceipts)
      .where(eq(orchestrationCommandReceipts.commandId, commandId))
      .get()

    return row ? rowToReceipt(row) : null
  }

  recordAccepted(
    command: OrchestrationCommand,
    sequence: number,
    result: ProjectRegistrationResult | null,
    intentFingerprint = commandFingerprint(command),
  ) {
    const aggregate = commandAggregate(command)
    const receipt = {
      acceptedAt: new Date().toISOString(),
      aggregateId: aggregate.id,
      aggregateKind: aggregate.kind,
      commandId: command.commandId,
      commandJson: JSON.stringify(command),
      commandType: command.type,
      error: null,
      resultJson: result ? JSON.stringify(result) : null,
      intentFingerprint,
      resultSequence: sequence,
      status: 'accepted' as const,
    }

    this.database.insert(orchestrationCommandReceipts).values(receipt).run()
    recordChatPipelineInfo('chat.pipeline.command_receipt.accepted', {
      ...orchestrationCommandSummary(command),
      resultSequence: sequence,
    })

    return rowToReceipt(receipt)
  }

  recordPreparationRejected(
    command: ClientOrchestrationCommand,
    error: unknown,
    intentFingerprint: string,
  ) {
    if (!isDurableCommandRejection(error) || command.type === 'project.create') return null
    const existing = this.find(command.commandId)
    if (existing) {
      verifyReceiptIntent(existing, command.type, intentFingerprint)
      return existing
    }
    return this.recordRejected(command, error, intentFingerprint)
  }

  recordRejected(
    command: ReceiptCommand,
    error: unknown,
    intentFingerprint = commandFingerprint(command),
  ) {
    const aggregate = commandAggregate(command)
    const receipt = {
      acceptedAt: new Date().toISOString(),
      aggregateId: aggregate.id,
      aggregateKind: aggregate.kind,
      commandId: command.commandId,
      commandJson: JSON.stringify(command),
      commandType: command.type,
      error: errorMessage(error),
      resultJson: null,
      intentFingerprint,
      resultSequence: null,
      status: 'rejected' as const,
    }

    this.database.insert(orchestrationCommandReceipts).values(receipt).run()
    recordChatPipelineWarning('chat.pipeline.command_receipt.rejected', {
      ...orchestrationCommandSummary(command),
      error: receipt.error,
    })

    return rowToReceipt(receipt)
  }
}

/**
 * A rejection receipt is permanent: once written, that `commandId` is poisoned
 * and can never be retried. Only a decision about the command *itself* earns
 * one — the catalogued invariant violations the decider raises, which are
 * structured errors carrying a 4xx status and which will fail identically no
 * matter how often the command is replayed.
 *
 * Everything else — a plain `Error`, a `SQLiteError` from a disk blip, any 5xx
 * structured error — is an infrastructure failure whose next attempt may well
 * succeed. Those leave no receipt at all, so the client can retry the same
 * `commandId` and still get exactly-once semantics.
 *
 * The test is the structured error's identity (`EvlogError` + `status`), never
 * its message text: rewording a catalog entry must not silently change which
 * failures become permanent.
 */
export function isDurableCommandRejection(error: unknown) {
  if (!isEvlogError(error)) return false

  return error.status >= 400 && error.status < 500
}

export function commandAggregate(command: ReceiptCommand) {
  switch (command.type) {
    case 'project.create':
    case 'project.delete':
    case 'project.meta.update':
    case 'project.reorder':
    case 'project.revive':
      return { id: command.projectId, kind: 'project' as const }
    case 'worktree.retry':
    case 'worktree.cleanup':
    case 'worktree.force-cleanup':
    case 'worktree.retain':
    case 'worktree.adopt':
    case 'worktree.release':
    case 'worktree.resolve-missing':
    case 'worktree.create.complete':
    case 'worktree.create.fail':
    case 'worktree.cleanup.complete':
    case 'worktree.cleanup.blocked':
    case 'worktree.cleanup.fail':
    case 'worktree.mark-missing':
    case 'worktree.metadata.refresh':
    case 'worktree.orphan.register':
    case 'terminal.lease.request':
    case 'terminal.lease.claim':
    case 'terminal.lease.activate':
    case 'terminal.lease.terminate':
    case 'terminal.lease.end':
    case 'terminal.lease.mark-unknown':
    case 'worktree.register':
    case 'worktree.revive':
      return { id: command.worktreeId, kind: 'worktree' as const }
    case 'session.worktree.release':
    case 'session.activity.append':
    case 'session.approval.respond':
    case 'session.archive':
    case 'session.checkpoint.revert':
    case 'session.create':
    case 'session.delete':
    case 'session.deletion.update':
    case 'session.discover':
    case 'session.discovery-metadata.update':
    case 'session.terminal-history.append':
    case 'session.history.import':
    case 'session.interaction-mode.set':
    case 'session.message.assistant.complete':
    case 'session.message.assistant.delta':
    case 'session.meta.update':
    case 'session.pin':
    case 'session.pin.reorder':
    case 'session.proposed-plan.upsert':
    case 'session.provider-start.adopt':
    case 'session.provider-start.claim':
    case 'session.provider-start.settle':
    case 'session.revert.complete':
    case 'session.runtime-mode.set':
    case 'session.runtime.recover':
    case 'session.runtime.set':
    case 'session.runtime.stop':
    case 'session.settle':
    case 'session.snooze':
    case 'session.turn.diff.complete':
    case 'session.turn.interrupt':
    case 'session.turn.start':
    case 'session.unarchive':
    case 'session.unpin':
    case 'session.unsettle':
    case 'session.unsnooze':
    case 'session.user-input.respond':
      return { id: command.sessionId, kind: 'session' as const }
    default: {
      const exhaustive: never = command
      return exhaustive
    }
  }
}

function rowToReceipt(row: OrchestrationCommandReceiptRow): OrchestrationCommandReceipt {
  return v.parse(orchestrationCommandReceiptSchema, {
    acceptedAt: row.acceptedAt,
    aggregateId: row.aggregateId,
    aggregateKind: row.aggregateKind,
    commandId: row.commandId,
    commandType: row.commandType,
    error: row.error,
    intentFingerprint: row.intentFingerprint,
    result: row.resultJson ? JSON.parse(row.resultJson) : null,
    resultSequence: row.resultSequence,
    status: row.status,
  })
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message

  return String(error)
}

export function verifyReceiptIntent(
  receipt: OrchestrationCommandReceipt,
  commandType: string,
  fingerprint: string,
) {
  if (receipt.commandType === commandType && receipt.intentFingerprint === fingerprint) return
  throw sessionDomainErrors.COMMAND_ID_COLLISION({ commandId: receipt.commandId })
}
