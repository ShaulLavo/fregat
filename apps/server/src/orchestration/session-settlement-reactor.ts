import * as v from 'valibot'
import {
  commandIdSchema,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type SessionId,
} from '@workspace/contracts'
import { recordProcessInfo, recordProcessWarning } from '../observability'
import type { OrchestrationReadModel } from './read-model'
import { autoSettlementAt, type AutoSettleRules } from './utils/auto-settlement'
import { internalCommandKey } from './utils/repository-ids'
import { SweepScheduler } from './sweep-scheduler'

type Options = {
  getReadModel: () => OrchestrationReadModel
  dispatch: (command: OrchestrationCommand) => Promise<unknown>
  rules: (projectId: string) => AutoSettleRules
  backgroundLive: (sessionId: SessionId) => boolean
  now?: () => number
  intervalMs?: number
}

const SWEEP_INTERVAL_MS = 5 * 60_000

/**
 * Settles sessions the owner server finds finished: inactive past the configured days, or whose
 * worktree's pull request merged or closed after the last request. Each decision carries the
 * sequence it read, and the engine refuses it if the session moved since.
 */
export class SessionSettlementReactor {
  readonly name = 'session-settlement-reactor'
  private readonly options: Options
  private readonly now: () => number
  private readonly sweeps: SweepScheduler

  constructor(options: Options) {
    this.options = options
    this.now = options.now ?? Date.now
    this.sweeps = new SweepScheduler({
      sweep: () => this.sweep(),
      failureEvent: 'chat.auto_settle.failed',
      area: 'chat',
      intervalMs: options.intervalMs ?? SWEEP_INTERVAL_MS,
    })
  }

  start() {
    this.sweeps.start()
  }

  // A merged or closed pull request settles now rather than on the next sweep.
  handleEvents(events: OrchestrationEvent[]) {
    if (events.some((event) => event.type === 'worktree.pull-request-synced')) this.schedule()
  }

  schedule() {
    this.sweeps.schedule()
  }

  drain() {
    return this.sweeps.drain()
  }

  close() {
    return this.sweeps.close()
  }

  private async sweep() {
    const model = this.options.getReadModel()
    const now = this.now()
    const decisions = []
    for (const session of model.sessions.values()) {
      const worktree = model.worktrees.get(session.worktreeId)
      if (!worktree) continue
      const rules = this.options.rules(worktree.projectId)
      if (rules.afterDays === 0 && !rules.onMerge) continue
      const settledAt = autoSettlementAt({
        session,
        pullRequest: worktree.pullRequest,
        backgroundLive: this.options.backgroundLive(session.id),
        now,
        rules,
      })
      if (settledAt) decisions.push({ sessionId: session.id, settledAt })
    }
    let settled = 0
    for (const decision of decisions) {
      if (await this.settle(decision, model.sequence)) settled += 1
    }
    if (decisions.length === 0) return
    recordProcessInfo('chat.auto_settle', {
      area: 'chat',
      candidates: decisions.length,
      settled,
      snapshotSequence: model.sequence,
    })
  }

  private async settle(decision: { sessionId: SessionId; settledAt: string }, sequence: number) {
    try {
      await this.options.dispatch({
        type: 'session.auto-settle',
        sessionId: decision.sessionId,
        settledAt: decision.settledAt,
        snapshotSequence: sequence,
        commandId: v.parse(
          commandIdSchema,
          internalCommandKey('auto-settle', decision.sessionId, crypto.randomUUID()),
        ),
      })
      return true
    } catch (error) {
      // The session moved since the read; the next sweep decides from the new state.
      recordProcessWarning('chat.auto_settle.skipped', {
        area: 'chat',
        sessionId: decision.sessionId,
        error,
      })
      return false
    }
  }
}
