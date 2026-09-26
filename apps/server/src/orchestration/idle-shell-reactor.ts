import type { OrchestrationEvent, WorktreeId } from '@workspace/contracts'
import type { TerminalService } from '../terminal/service'
import type { OrchestrationReadModel } from './read-model'
import { recordChatPipelineInfo, recordChatPipelineWarning } from './orchestration-logging'
import { SerialWorker } from './serial-worker'
import type { OrchestrationDomainEventReactor } from './streams'

type Options = {
  readonly getReadModel: () => OrchestrationReadModel
  readonly terminals: Pick<TerminalService, 'closeIdleWorktreeShells'>
}

/**
 * Once the last live session on a worktree settles or archives, its shells that sit at an idle
 * prompt close, keeping their output, so a finished worktree stops holding processes.
 */
export class IdleShellReactor implements OrchestrationDomainEventReactor {
  readonly name = 'idle-shell-reactor'
  private readonly options: Options
  private readonly worker: SerialWorker<WorktreeId>

  constructor(options: Options) {
    this.options = options
    this.worker = new SerialWorker((worktreeId) => this.closeIdleShells(worktreeId))
  }

  handleEvents(events: OrchestrationEvent[]) {
    for (const event of events) {
      if (event.type !== 'session.settled' && event.type !== 'session.archived') continue
      const session = this.options.getReadModel().sessions.get(event.payload.sessionId)
      if (!session) continue
      void this.worker.enqueue(session.worktreeId)
    }
  }

  drain() {
    return this.worker.drain()
  }

  isIdle() {
    return this.worker.isIdle()
  }

  // Re-read when the task runs: a session unsettled or started meanwhile keeps the shells.
  private async closeIdleShells(worktreeId: WorktreeId) {
    if (hasLiveSession(this.options.getReadModel(), worktreeId)) return
    try {
      const { closed } = await this.options.terminals.closeIdleWorktreeShells(worktreeId)
      if (closed > 0)
        recordChatPipelineInfo('chat.pipeline.idle_shells.closed', { worktreeId, closed })
    } catch (error) {
      recordChatPipelineWarning('chat.pipeline.idle_shells.close_failed', { worktreeId, error })
    }
  }
}

function hasLiveSession(model: OrchestrationReadModel, worktreeId: WorktreeId) {
  for (const session of model.sessions.values()) {
    if (session.worktreeId !== worktreeId) continue
    if (session.deletedAt || session.archivedAt) continue
    if (session.settledOverride === 'settled') continue
    return true
  }
  return false
}
