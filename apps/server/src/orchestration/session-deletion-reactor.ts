import { createAttachmentOwnership } from '../attachments/ownership'
import { errorMessage } from '@workspace/contracts'
import * as v from 'valibot'
import {
  commandIdSchema,
  type SessionId,
  type SessionDeletionState,
  type OrchestrationCommand,
  type OrchestrationEvent,
} from '@workspace/contracts'
import { deleteAttachmentBlobs } from '../attachments/store'
import { sessionAttachments } from './session-attachments'
import type { OrchestrationDatabase } from './event-store'
import type { ProviderService } from '../provider/provider-service'
import type { OrchestrationReadModel } from './read-model'
import type { TerminalService } from '../terminal/service'

import { internalCommandKey } from './utils/repository-ids'
import { recordChatPipelineInfo, recordChatPipelineWarning } from './orchestration-logging'
import { SerialWorker } from './serial-worker'
import type { OrchestrationDomainEventReactor } from './streams'
import { sessionDomainErrors } from './structured-errors'

type Options = {
  attachmentsDir: string
  database: OrchestrationDatabase
  providerService: ProviderService | null
  getReadModel: () => OrchestrationReadModel
  dispatch: (command: OrchestrationCommand) => Promise<unknown>
  /** Closes the terminals the session itself owns; worktree shells stay open. */
  terminals: Pick<TerminalService, 'closeSessionTerminals'> | null
}

export class SessionDeletionReactor implements OrchestrationDomainEventReactor {
  readonly name = 'session-deletion-reactor'
  private readonly worker: SerialWorker<SessionId>
  private readonly cleaning = new Set<SessionId>()
  private readonly generation = crypto.randomUUID()
  private attempt = 0

  private readonly options: Options

  constructor(options: Options) {
    this.options = options
    this.worker = new SerialWorker((sessionId) => this.cleanup(sessionId))
  }

  handleEvents(events: OrchestrationEvent[]) {
    for (const event of events) {
      if (event.type !== 'session.deleted') continue
      this.enqueue(event.payload.sessionId)
    }
  }

  async recover() {
    for (const session of this.options.getReadModel().sessions.values()) {
      if (!session.deletedAt) continue
      // A restart ends every terminal process, but a deleted session's saved history survives it.
      await this.closeTerminals(session.id)
      if (!session.deletion || cleanupComplete(session.deletion)) continue
      this.enqueue(session.id)
    }
    await this.drain()
  }

  drain() {
    return this.worker.drain()
  }
  isIdle() {
    return this.worker.isIdle()
  }

  private enqueue(sessionId: SessionId) {
    if (this.cleaning.has(sessionId)) return
    this.cleaning.add(sessionId)
    void this.worker
      .enqueue(sessionId)
      .catch((error) => {
        recordChatPipelineWarning('chat.pipeline.session_deletion.cleanup', { sessionId, error })
      })
      .finally(() => this.cleaning.delete(sessionId))
  }

  private async cleanup(sessionId: SessionId) {
    const previous = this.options.getReadModel().sessions.get(sessionId)?.deletion
    if (!previous || cleanupComplete(previous)) return
    const startedAt = performance.now()
    const terminals = await this.closeTerminals(sessionId)
    const provider = await this.releaseRuntime(sessionId, previous)
    const blobs = await this.reclaimBlobs(sessionId, previous)
    const deletion: SessionDeletionState = {
      ...previous,
      ...provider,
      ...blobs,
      updatedAt: new Date().toISOString(),
    }
    await this.options.dispatch({
      type: 'session.deletion.update',
      sessionId,
      deletion,
      commandId: v.parse(
        commandIdSchema,
        internalCommandKey(
          'session-deletion',
          sessionId,
          deletion.deletionSequence,
          this.generation,
          ++this.attempt,
        ),
      ),
    })
    const context = {
      sessionId,
      ...deletion,
      ...terminals,
      durationMs: Math.round(performance.now() - startedAt),
    }
    if (cleanupComplete(deletion) && terminals.terminalCleanup !== 'failed') {
      recordChatPipelineInfo('chat.pipeline.session_deletion.cleanup', context)
      return
    }
    recordChatPipelineWarning('chat.pipeline.session_deletion.cleanup', context)
  }

  private async closeTerminals(sessionId: SessionId) {
    const terminals = this.options.terminals
    if (!terminals) return { terminalCleanup: 'no-terminals' as const, terminalsClosed: 0 }
    try {
      const { closed } = await terminals.closeSessionTerminals(sessionId)
      return { terminalCleanup: 'completed' as const, terminalsClosed: closed }
    } catch (error) {
      return { terminalCleanup: 'failed' as const, terminalCleanupError: errorMessage(error) }
    }
  }

  private async releaseRuntime(
    sessionId: SessionId,
    previous: SessionDeletionState,
  ): Promise<Pick<SessionDeletionState, 'providerStop' | 'providerStopError'>> {
    if (previous.providerStop === 'completed' || previous.providerStop === 'no-binding') {
      return { providerStop: previous.providerStop, providerStopError: null }
    }
    try {
      const service = this.options.providerService
      if (!service || !(await service.hasRuntime({ sessionId })))
        return { providerStop: 'no-binding', providerStopError: null }
      await service.stopRuntime({ sessionId })
      if (await service.hasRuntime({ sessionId }))
        throw sessionDomainErrors.CLEANUP_FAILED({ sessionId })
      return { providerStop: 'completed', providerStopError: null }
    } catch (error) {
      return { providerStop: 'failed', providerStopError: errorMessage(error) }
    }
  }

  private async reclaimBlobs(
    sessionId: SessionId,
    previous: SessionDeletionState,
  ): Promise<Pick<SessionDeletionState, 'blobCleanup' | 'blobCleanupError'>> {
    if (previous.blobCleanup === 'completed')
      return { blobCleanup: 'completed', blobCleanupError: null }
    try {
      const ownership = createAttachmentOwnership(this.options.database)
      const attachments = [
        ...new Map(
          [
            ...sessionAttachments(this.options.database, sessionId),
            ...ownership.attachmentsForSession(sessionId),
          ].map((attachment) => [attachment.id, attachment]),
        ).values(),
      ]
      await deleteAttachmentBlobs({
        attachments,
        attachmentsDir: this.options.attachmentsDir,
        ownership,
      })
      return { blobCleanup: 'completed', blobCleanupError: null }
    } catch (error) {
      return { blobCleanup: 'failed', blobCleanupError: errorMessage(error) }
    }
  }
}

function cleanupComplete(state: SessionDeletionState) {
  return (
    (state.providerStop === 'completed' || state.providerStop === 'no-binding') &&
    state.blobCleanup === 'completed'
  )
}
